import { ALERT_CITIES } from "../../shared/alertCities.js";
import { createHash } from "node:crypto";
import { AlertStore } from "./store.js";
import { collectNews } from "./sources.js";
import { createRequest, extractIncidents, validateExtraction } from "./extract.js";
import { locateIncidents } from "./geocode.js";

export const ANALYSIS_INTERVAL = 12 * 3600000;
const pending = new Map();

export function createAlertService({
  store = new AlertStore(),
  collect = collectNews,
  extract = extractIncidents,
  locate = locateIncidents,
  getKey = () => process.env.GROQ_API_KEY,
  now = () => Date.now(),
} = {}) {
  function present(record, extra = {}) {
    return {
      incidents: record?.incidents || [],
      analyzedAt: record?.analyzedAt || null,
      nextAnalysisAt: record?.nextAnalysisAt || null,
      lastAttemptAt: record?.lastAttemptAt || null,
      articleCount: record?.articleCount || 0,
      usage: record?.usage || null,
      message: record?.message || "",
      stale: Boolean(
        record?.analyzedAt && now() - Date.parse(record.analyzedAt) >= ANALYSIS_INTERVAL,
      ),
      phase: "cached",
      ...extra,
    };
  }

  async function update(cityId) {
    const city = ALERT_CITIES[cityId];
    if (!Object.hasOwn(ALERT_CITIES, cityId)) throw new Error("Unknown city");
    let record = await store.read(cityId);
    if (Date.parse(record?.nextAnalysisAt) > now()) return present(record);
    if (!getKey())
      return present(record, {
        phase: "unconfigured",
        message: "Server GROQ_API_KEY is missing.",
      });
    const unlock = await store.lock();
    if (!unlock)
      return present(record, {
        phase: "processing",
        message: "An analysis is in progress. Checking the cache shortly.",
      });
    try {
      record = await store.read(cityId);
      if (Date.parse(record?.nextAnalysisAt) > now()) return present(record);
      let articles;
      try {
        articles = await collect(city);
      } catch {
        record = {
          ...record,
          nextAnalysisAt: new Date(now() + 15 * 60000).toISOString(),
          message: "News source unavailable. Checking again in 15 minutes; no AI call was made.",
        };
        await store.write(cityId, record);
        return present(record);
      }
      const timestamp = new Date(now()).toISOString();
      const base = {
        ...record,
        articleCount: articles.length,
        message: "",
        nextAnalysisAt: new Date(now() + ANALYSIS_INTERVAL).toISOString(),
      };
      if (!articles.length) {
        const empty = {
          ...base,
          incidents: [],
          analyzedAt: timestamp,
          usage: { totalTokens: 0 },
        };
        await store.write(cityId, empty);
        return present(empty);
      }
      const signature = (article) =>
        createHash("sha256")
          .update(article.id + article.text)
          .digest("hex");
      const processed = new Set(record?.processed || []);
      const fresh = articles.filter((article) => !processed.has(signature(article)));
      if (!fresh.length) {
        const unchanged = {
          ...base,
          message: "No new headlines to analyze. Serving saved reports.",
        };
        await store.write(cityId, unchanged);
        return present(unchanged);
      }
      const request = createRequest(city, fresh);
      const day = timestamp.slice(0, 10);
      let budget = await store.read("budget");
      if (budget?.day !== day) budget = { day, spent: 0 };
      const configured = Number(process.env.ALERT_DAILY_TOKEN_LIMIT || 20000);
      const limit = Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : 20000;
      // UTF-8 bytes provide a conservative input-token bound, plus output and framing.
      const reserved =
        Buffer.byteLength(JSON.stringify(request.messages)) +
        Buffer.byteLength(JSON.stringify(request.response_format)) +
        request.max_completion_tokens +
        512;
      if (budget.spent + reserved > limit) {
        return present(record, {
          phase: "budget",
          message: "Daily AI token budget reached. Cached reports remain available.",
        });
      }
      // Persist both the quota and attempt before contacting Groq. Failures also wait 12 hours.
      await store.write("budget", { day, spent: budget.spent + reserved });
      record = {
        ...base,
        lastAttemptAt: timestamp,
        message: "Analysis did not complete. Next AI attempt after the 12-hour interval.",
      };
      await store.write(cityId, record);
      let output;
      try {
        output = await extract(request, getKey());
        const incidents = validateExtraction(output.result, fresh);
        const located = await locate(city, incidents, record.locations);
        const retained = (record.incidents || []).filter(
          (incident) =>
            now() - Date.parse(incident.publishedAt) < 36 * 3600000 &&
            !incidents.some((next) => next.id === incident.id),
        );
        record = {
          ...record,
          ...located,
          incidents: [...located.incidents, ...retained].slice(0, 18),
          processed: [...processed, ...fresh.map(signature)].slice(-200),
          analyzedAt: timestamp,
          message: "",
          usage: { totalTokens: output.tokens, model: request.model },
        };
        await store.write(cityId, record);
      } catch {
        return present(record);
      }
      const used = Number.isFinite(output.tokens) && output.tokens > 0 ? output.tokens : reserved;
      await store.write("budget", { day, spent: budget.spent + used });
      return present(record);
    } finally {
      await unlock();
    }
  }

  return async (cityId) => {
    const key = store.directory + ":" + cityId;
    if (pending.has(key)) return pending.get(key);
    const task = update(cityId)
      .then((result) => {
        // Search results may mention the city only in the article body. Require headline evidence.
        const city = ALERT_CITIES[cityId];
        const names = [city.name, city.localName]
          .filter(Boolean)
          .map((name) => name.toLocaleLowerCase());
        return {
          ...result,
          incidents: result.incidents.filter((incident) =>
            names.some((name) => incident.title?.toLocaleLowerCase().includes(name)),
          ),
        };
      })
      .finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  };
}

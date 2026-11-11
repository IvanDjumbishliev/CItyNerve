import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { join } from "node:path";
import { AlertStore } from "../server/alerts/store.js";
import { createAlertService, ANALYSIS_INTERVAL } from "../server/alerts/service.js";
import { validateExtraction } from "../server/alerts/extract.js";
import { resolveCandidate } from "../server/alerts/geocode.js";
import { parseNews } from "../server/alerts/sources.js";
import { ALERT_CITIES } from "../shared/alertCities.js";

async function setup(t, overrides = {}) {
  await mkdir(".cache/alerts", { recursive: true });
  const directory = await mkdtemp(".cache/alerts/tests-");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AlertStore(directory);
  let time = Date.now();
  let calls = 0;
  let headline = "Fire on Vitosha in Sofia";
  const options = {
    store,
    now: () => time,
    getKey: () => "test-key",
    collect: async () => [{ id: "a", text: headline, publishedAt: new Date(time).toISOString() }],
    extract: async () => {
      calls++;
      return { result: { incidents: [] }, tokens: 50 };
    },
    locate: async (_, incidents) => ({ incidents, locations: {} }),
    ...overrides,
  };
  return {
    store,
    options,
    service: createAlertService(options),
    calls: () => calls,
    advance: () => {
      time += ANALYSIS_INTERVAL + 1;
      headline += " updated";
    },
  };
}

test("parallel refreshes and a new service share one persistent 12-hour city slot", async (t) => {
  const state = await setup(t);
  await Promise.all(Array.from({ length: 8 }, () => state.service("sofia")));
  await createAlertService(state.options)("sofia");
  assert.equal(state.calls(), 1);
  await state.service("basel");
  assert.equal(state.calls(), 2);
  state.advance();
  await state.service("sofia");
  assert.equal(state.calls(), 3);
});

test("failed AI consumes its slot, including after restart", async (t) => {
  let calls = 0;
  const state = await setup(t, {
    extract: async () => {
      calls++;
      throw Error("offline");
    },
  });
  await state.service("sofia");
  await createAlertService(state.options)("sofia");
  assert.equal(calls, 1);
});

test("separate city workers serialize safely through a shared filesystem lock", async (t) => {
  const state = await setup(t);
  const unlock = await state.store.lock();
  const blocked = await state.service("sofia");
  assert.equal(blocked.phase, "processing");
  assert.equal(state.calls(), 0);
  await unlock();
  await state.service("sofia");
  assert.equal(state.calls(), 1);
});

test("unchanged headlines do not spend tokens after 12 hours", async (t) => {
  const article = {
    id: "a",
    text: "Fire",
    publishedAt: new Date().toISOString(),
  };
  const state = await setup(t, { collect: async () => [article] });
  await state.service("sofia");
  state.advance();
  await state.service("sofia");
  assert.equal(state.calls(), 1);
});

test("missing keys, empty feeds and source failures do not call AI", async (t) => {
  for (const overrides of [
    { getKey: () => "" },
    { collect: async () => [] },
    {
      collect: async () => {
        throw Error("offline");
      },
    },
  ]) {
    const state = await setup(t, overrides);
    await state.service("sofia");
    assert.equal(state.calls(), 0);
  }
});

test("exhausted quota and corrupt cache fail closed", async (t) => {
  const state = await setup(t);
  await state.store.write("budget", {
    day: new Date().toISOString().slice(0, 10),
    spent: 1e12,
  });
  assert.equal((await state.service("sofia")).phase, "budget");
  assert.equal(state.calls(), 0);
  await writeFile(join(state.store.directory, "sofia.json"), "broken");
  await assert.rejects(state.service("sofia"), /cannot be read/);
  assert.equal(state.calls(), 0);
});

test("ungrounded locations and invented source IDs cannot create pins", () => {
  const articles = [{ id: "a", text: "Fire in Sofia", publishedAt: new Date().toISOString() }];
  const incident = {
    articleId: "a",
    category: "fire",
    summary: "A fire was reported",
    place: "Vitosha",
    evidence: "Fire on Vitosha",
    eventTime: "yesterday",
    status: "reported",
  };
  const result = validateExtraction(
    { incidents: [incident, { ...incident, articleId: "invented" }, null] },
    articles,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].place, "");
  assert.equal(result[0].location, null);
  assert.equal(result[0].eventTime, "");
});

test("geocoder rejects ambiguous, out-of-city and city-center matches", () => {
  const feature = {
    geometry: { coordinates: [23.33, 42.69] },
    properties: { name: "Vitosha", osm_type: "W", osm_id: 1 },
  };
  assert.ok(resolveCandidate(ALERT_CITIES.sofia, "Vitosha", [feature]));
  assert.equal(
    resolveCandidate(ALERT_CITIES.sofia, "Vitosha", [
      feature,
      { ...feature, properties: { ...feature.properties, osm_id: 2 } },
    ]),
    null,
  );
  assert.equal(
    resolveCandidate(ALERT_CITIES.sofia, "Vitosha", [
      { ...feature, geometry: { coordinates: [0, 0] } },
    ]),
    null,
  );
  assert.equal(resolveCandidate(ALERT_CITIES.sofia, "Sofia", []), null);
});

test("RSS parser deduplicates and ignores stale or unsafe links", () => {
  const item = (title, link, date) =>
    `<item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate><source>Publisher</source></item>`;
  const date = new Date().toUTCString();
  const xml = `<rss><channel>${item("Fire", "https://example.org/a", date)}${item("Fire", "https://example.org/b", date)}${item("Bad", "javascript:bad", date)}${item("Old", "https://example.org/c", "Mon, 01 Jan 2001 00:00:00 GMT")}</channel></rss>`;
  assert.equal(parseNews(xml).length, 1);
});

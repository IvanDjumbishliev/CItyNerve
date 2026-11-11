import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";

export async function fetchText(url, timeout = 15000) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { "User-Agent": "CityNerve-Incidents/1.0" },
  });
  if (!response.ok) throw new Error("Source is temporarily unavailable.");
  if (Number(response.headers.get("content-length")) > 1_000_000) {
    throw new Error("Source response exceeds the size limit.");
  }
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 1_000_000) {
      await reader.cancel();
      throw new Error("Source response exceeds the size limit.");
    }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts).toString("utf8");
}

export function parseNews(xml, now = Date.now()) {
  const feed = new XMLParser({ ignoreAttributes: false }).parse(xml);
  const raw = feed.rss?.channel?.item;
  if (!feed.rss?.channel) throw new Error("News source returned an invalid feed.");
  const articles = [];
  const seen = new Set();
  for (const item of raw ? (Array.isArray(raw) ? raw : [raw]) : []) {
    const published = Date.parse(item.pubDate);
    const title = String(item.title || "").slice(0, 400);
    let url;
    try {
      url = new URL(item.link);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || !title || !Number.isFinite(published)) continue;
    if (published > now + 300000 || now - published > 36 * 3600000) continue;
    const id = createHash("sha256").update(url.href).digest("hex").slice(0, 20);
    const signature = title.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(signature)) continue;
    seen.add(signature);
    articles.push({
      id,
      text: title,
      url: url.href,
      publisher: String(item.source?.["#text"] || item.source || "News publisher"),
      publishedAt: new Date(published).toISOString(),
    });
  }
  return articles.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 6);
}

export async function collectNews(city) {
  const query = `intitle:"${city.localName || city.name}" (${city.terms}) when:1d`;
  const url = new URL("https://news.google.com/rss/search");
  url.search = new URLSearchParams({
    q: query,
    hl: city.locale,
    gl: city.region,
    ceid: `${city.region}:${city.locale}`,
  });
  return parseNews(await fetchText(url));
}

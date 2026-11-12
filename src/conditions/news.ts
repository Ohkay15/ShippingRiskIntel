import type { FetchLike } from "@/integrations/http";
import { TtlCache } from "@/geo/cache";
import type { Place } from "@/geo/places";

/**
 * Freight-relevant news from the GDELT Project's DOC 2.0 API — free, no
 * key, global coverage. GDELT asks for at most one request every five
 * seconds, so calls are spaced through a module-level queue and every
 * query is cached for 20 minutes.
 */

const GDELT = "https://api.gdeltproject.org/api/v2/doc/doc";
let minGapMs = 5200;

/** Test hook: GDELT spacing in ms (default 5200). */
export function setNewsSpacing(ms: number): void {
  minGapMs = ms;
}

export interface NewsItem {
  title: string;
  url: string;
  domain: string;
  /** ISO timestamp GDELT first saw the article. */
  seenAt: string | null;
  image: string | null;
  country: string | null;
  /** Which feed it came from, for attribution. */
  provider: "gdelt" | "google_news";
}

interface GdeltArticle {
  url?: string;
  title?: string;
  seendate?: string;
  socialimage?: string;
  domain?: string;
  sourcecountry?: string;
  language?: string;
}

const cache = new TtlCache<NewsItem[]>(20 * 60 * 1000, 300);
let lastCall = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Run `fn` no sooner than the spacing gap after the previous GDELT call. */
function throttled<T>(fn: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastCall + minGapMs - now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

/** "20260708T124500Z" → ISO */
export function parseSeenDate(raw: string | undefined): string | null {
  const m = raw?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

const FREIGHT_TERMS = [
  "freight", "trucking", "truck", "highway", "interstate", "port", "railroad", "rail",
  "closure", "crash", "strike", "storm", "flooding", "snow", "cargo", "warehouse",
];

function quoteTerm(term: string): string {
  const t = term.replace(/["()]/g, "").trim();
  return /\s|-/.test(t) ? `"${t}"` : t;
}

function orGroup(terms: string[]): string {
  const unique = [...new Set(terms.map(quoteTerm).filter((t) => t.replace(/"/g, "").length >= 3))];
  if (unique.length === 0) return "";
  return unique.length === 1 ? unique[0] : `(${unique.join(" OR ")})`;
}

/** GDELT query for news touching a lane's endpoints and freight topics. */
export function laneNewsQuery(places: (Place | null)[]): string | null {
  const cities = places.filter((p): p is Place => p !== null).map((p) => p.name.split(",")[0]);
  const where = orGroup(cities);
  if (!where) return null;
  return [where, orGroup(FREIGHT_TERMS), "sourcelang:english"].join(" ");
}

export const NETWORK_NEWS_QUERY = [
  orGroup(["supply chain", "freight", "trucking", "port congestion", "railroad", "cargo theft", "shipping delays", "tariff"]),
  "sourcelang:english",
].join(" ");

function cleanTitle(title: string): string {
  return title.replace(/\s+/g, " ").replace(/\s+-\s+[^-]+$/, (tail) => (tail.length < 40 ? "" : tail)).trim();
}

/** Fetch text with a timeout; never throws on HTTP status (callers decide). */
async function fetchText(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  headers: Record<string, string> = {}
): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers, signal: controller.signal, cache: "no-store" });
    return { status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GDELT DOC 2.0. It answers errors as plain text (sometimes with HTTP 200). */
async function gdeltSearch(query: string, timespan: string, max: number, fetchImpl: FetchLike): Promise<NewsItem[]> {
  const url = `${GDELT}?query=${encodeURIComponent(query)}&mode=artlist&format=json&sort=datedesc&maxrecords=${max * 2}&timespan=${timespan}`;
  let attempt = await throttled(() => fetchText(url, fetchImpl, 15000));
  if (attempt.status === 429) {
    await sleep(minGapMs + 300);
    attempt = await throttled(() => fetchText(url, fetchImpl, 15000));
  }
  const body = attempt.text.trim();
  if (attempt.status !== 200 || !body.startsWith("{")) {
    throw new Error(`GDELT ${attempt.status}: ${body.slice(0, 200) || "empty response"}`);
  }
  const res = JSON.parse(body) as { articles?: GdeltArticle[] };
  const seen = new Set<string>();
  const items: NewsItem[] = [];
  for (const a of res.articles ?? []) {
    if (!a.url || !a.title || !/^https?:\/\//.test(a.url)) continue;
    const title = cleanTitle(a.title);
    const key = title.toLowerCase();
    if (seen.has(key)) continue; // syndicated duplicates
    seen.add(key);
    items.push({
      title,
      url: a.url,
      domain: a.domain ?? new URL(a.url).hostname,
      seenAt: parseSeenDate(a.seendate),
      image: a.socialimage && /^https:\/\//.test(a.socialimage) ? a.socialimage : null,
      country: a.sourcecountry ?? null,
      provider: "gdelt",
    });
    if (items.length >= max) break;
  }
  return items;
}

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Turn a GDELT query into plain keywords for the backup source. */
export function toKeywordQuery(gdeltQuery: string): string {
  return gdeltQuery.replace(/\b(sourcelang|sourcecountry|domain|domainis):\S+/g, "").replace(/\s+/g, " ").trim();
}

/** Parse a Google News RSS feed: headline, link and publisher only. */
export function parseNewsRss(xml: string, max: number): NewsItem[] {
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  for (const block of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const pick = (tag: string) => block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1];
    const link = decodeXml(pick("link") ?? "");
    const sourceMatch = block.match(/<source[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/);
    const publisher = sourceMatch ? decodeXml(sourceMatch[2]) : "";
    let title = decodeXml(pick("title") ?? "");
    if (publisher && title.endsWith(` - ${publisher}`)) title = title.slice(0, -(publisher.length + 3));
    if (!title || !/^https:\/\//.test(link) || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    const pub = pick("pubDate");
    const when = pub ? new Date(decodeXml(pub)) : null;
    let domain = publisher;
    if (!domain && sourceMatch?.[1]) {
      try {
        domain = new URL(decodeXml(sourceMatch[1])).hostname;
      } catch {
        domain = "";
      }
    }
    items.push({
      title,
      url: link,
      domain: domain || "news.google.com",
      seenAt: when && !Number.isNaN(when.getTime()) ? when.toISOString() : null,
      image: null,
      country: null,
      provider: "google_news",
    });
    if (items.length >= max) break;
  }
  return items;
}

/** Backup: Google News search RSS (headlines and links only). */
async function googleNewsSearch(query: string, timespan: string, max: number, fetchImpl: FetchLike): Promise<NewsItem[]> {
  const q = `${toKeywordQuery(query)} when:${timespan}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetchText(url, fetchImpl, 10000, { "User-Agent": "Mozilla/5.0 (compatible; ShippingRiskIntel/1.0)" });
  if (res.status !== 200 || !res.text.includes("<rss")) {
    throw new Error(`Google News ${res.status}: ${res.text.slice(0, 120)}`);
  }
  return parseNewsRss(res.text, max);
}

/**
 * News for a query: GDELT first; if it errors (it rate-limits shared cloud
 * IPs), Google News RSS. Failures are logged with the upstream message so
 * they show up in the hosting logs.
 */
export async function searchNews(
  query: string,
  opts: { timespan?: string; max?: number; fetchImpl?: FetchLike } = {}
): Promise<NewsItem[]> {
  const timespan = opts.timespan ?? "3d";
  const max = Math.min(opts.max ?? 12, 50);
  const fetchImpl = opts.fetchImpl ?? fetch;
  return cache.getOrLoad(`${timespan}|${max}|${query}`, async () => {
    try {
      return await gdeltSearch(query, timespan, max, fetchImpl);
    } catch (gdeltError) {
      console.warn(`[news] ${gdeltError instanceof Error ? gdeltError.message : String(gdeltError)}`);
      try {
        return await googleNewsSearch(query, timespan, max, fetchImpl);
      } catch (backupError) {
        console.warn(`[news] ${backupError instanceof Error ? backupError.message : String(backupError)}`);
        throw backupError;
      }
    }
  });
}

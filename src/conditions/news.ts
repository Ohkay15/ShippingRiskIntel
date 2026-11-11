import { requestJson, type FetchLike } from "@/integrations/http";
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
  const allUs = places.every((p) => !p || p.country === "US");
  return [where, orGroup(FREIGHT_TERMS), "sourcelang:english", allUs ? "sourcecountry:unitedstates" : ""]
    .filter(Boolean)
    .join(" ");
}

export const NETWORK_NEWS_QUERY = [
  orGroup(["supply chain", "freight", "trucking", "port congestion", "railroad", "cargo theft", "shipping delays", "tariff"]),
  "sourcelang:english",
  "sourcecountry:unitedstates",
].join(" ");

function cleanTitle(title: string): string {
  return title.replace(/\s+/g, " ").replace(/\s+-\s+[^-]+$/, (tail) => (tail.length < 40 ? "" : tail)).trim();
}

export async function searchNews(
  query: string,
  opts: { timespan?: string; max?: number; fetchImpl?: FetchLike } = {}
): Promise<NewsItem[]> {
  const timespan = opts.timespan ?? "3d";
  const max = Math.min(opts.max ?? 12, 50);
  return cache.getOrLoad(`${timespan}|${max}|${query}`, () =>
    throttled(async () => {
      const url = `${GDELT}?query=${encodeURIComponent(query)}&mode=artlist&format=json&sort=datedesc&maxrecords=${max * 2}&timespan=${timespan}`;
      const res = await requestJson<{ articles?: GdeltArticle[] }>({
        connectorId: "gdelt_news",
        url,
        timeoutMs: 9000,
        fetchImpl: opts.fetchImpl,
      });
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
        });
        if (items.length >= max) break;
      }
      return items;
    })
  );
}

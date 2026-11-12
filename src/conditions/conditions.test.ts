import { describe, expect, it } from "vitest";

import { geocode } from "@/geo/geocode";
import { bbox, distanceKm, greatCircle, samplePath, type LngLat } from "@/geo/lane";
import { lookupPlace } from "@/geo/places";
import { laneRoute } from "@/geo/route";
import { TtlCache, publicApiUserAgent } from "@/geo/cache";

import { alertsAlongPath, inNwsCoverage, isMarineAlert, pathHitsAlert, type WeatherAlert } from "./alerts";
import { laneNewsQuery, parseNewsRss, parseSeenDate, searchNews, setNewsSpacing, toKeywordQuery } from "./news";
import { networkConditions, routeConditions } from "./service";

setNewsSpacing(0);

const CHI: LngLat = [-87.63, 41.878];
const CMH: LngLat = [-82.999, 39.961];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Routes fetches by host to canned handlers and records calls. */
function fakeFetch(handlers: Record<string, (url: URL, init?: RequestInit) => Response | Promise<Response>>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push({ url: input, headers: (init?.headers ?? {}) as Record<string, string> });
    const handler = handlers[url.host];
    if (!handler) throw new Error(`unexpected host ${url.host}`);
    return handler(url, init);
  };
  return { impl, calls };
}

const nwsFeature = (id: string, event: string, severity: string, geometry: WeatherAlert["geometry"] = null) => ({
  id: `https://api.weather.gov/alerts/${id}`,
  geometry,
  properties: {
    id,
    event,
    severity,
    headline: `${event} issued`,
    areaDesc: "Franklin; Delaware; Licking",
    onset: "2026-11-11T18:00:00Z",
    ends: "2026-11-12T06:00:00Z",
    senderName: "NWS Wilmington OH",
    description: "  Heavy   snow expected.  ",
    instruction: "Avoid travel.",
  },
});

describe("places", () => {
  it("resolves common freight hubs locally, tolerating formatting", () => {
    expect(lookupPlace("Chicago, IL")?.name).toBe("Chicago, IL");
    expect(lookupPlace("chicago il")?.name).toBe("Chicago, IL");
    expect(lookupPlace("Port of Oakland, CA")?.name).toBe("Oakland, CA");
    expect(lookupPlace("Columbus, OH 43215")?.name).toBe("Columbus, OH");
    expect(lookupPlace("Saint Louis, MO")?.name).toBe("St. Louis, MO");
    expect(lookupPlace("Portland, ME")?.region).toBe("ME");
    expect(lookupPlace("Rotterdam")?.country).toBe("NL");
    expect(lookupPlace("A")).toBeNull();
    expect(lookupPlace("")).toBeNull();
  });
});

describe("lane geometry", () => {
  it("measures and samples a great circle", () => {
    const km = distanceKm(CHI, CMH);
    expect(km).toBeGreaterThan(430);
    expect(km).toBeLessThan(460);
    const path = greatCircle(CHI, CMH, 32);
    expect(path).toHaveLength(33);
    expect(path[0][0]).toBeCloseTo(CHI[0], 5);
    expect(path[32][1]).toBeCloseTo(CMH[1], 5);
    const probes = samplePath(path, 120, 10);
    expect(probes[0]).toEqual(path[0]);
    expect(probes[probes.length - 1]).toEqual(path[32]);
    expect(probes.length).toBeGreaterThanOrEqual(4);
    expect(samplePath(greatCircle([-118.24, 34.05], [-74.0, 40.7], 200), 50, 10)).toHaveLength(10);
    expect(bbox([CHI, CMH])).toEqual([CHI[0], CMH[1], CMH[0], CHI[1]]);
  });

  it("uses a straight lane unless a self-hosted router is configured", async () => {
    const plain = await laneRoute(CHI, CMH, { env: {} });
    expect(plain).toMatchObject({ approximate: true, source: "great_circle" });

    const { impl, calls } = fakeFetch({
      "osrm.internal:5000": () =>
        jsonResponse({ code: "Ok", routes: [{ distance: 571000, duration: 19800, geometry: { coordinates: [CHI, [-85, 41], CMH] } }] }),
    });
    const road = await laneRoute(CHI, CMH, { env: { ROUTING_URL: "http://osrm.internal:5000/" }, fetchImpl: impl });
    expect(road).toMatchObject({ approximate: false, source: "osrm", distanceKm: 571, durationH: 5.5 });
    expect(calls[0].url).toContain("/route/v1/driving/-87.63,41.878;-82.999,39.961");

    const broken = fakeFetch({ "osrm.down:5000": () => new Response("nope", { status: 502 }) });
    const fallback = await laneRoute(CHI, CMH, { env: { ROUTING_URL: "http://osrm.down:5000" }, fetchImpl: broken.impl });
    expect(fallback.source).toBe("great_circle");
  });
});

describe("geocoding", () => {
  it("prefers the built-in list and falls back to Nominatim with a User-Agent", async () => {
    const { impl, calls } = fakeFetch({
      "nominatim.openstreetmap.org": () =>
        jsonResponse([{ lat: "36.33", lon: "-119.29", display_name: "Visalia", address: { country_code: "us", "ISO3166-2-lvl4": "US-CA" } }]),
    });
    expect((await geocode("Dallas, TX", { fetchImpl: impl }))?.name).toBe("Dallas, TX");
    expect(calls).toHaveLength(0);
    const visalia = await geocode("Visalia, CA", { fetchImpl: impl, env: { APP_URL: "https://app.example" } });
    expect(visalia).toMatchObject({ lat: 36.33, lon: -119.29, region: "CA", country: "US" });
    expect(calls[0].headers["User-Agent"]).toBe("ShippingRiskIntel/1.0 (https://app.example)");
    await geocode("Visalia, CA", { fetchImpl: impl });
    expect(calls).toHaveLength(1); // cached
    expect(await geocode("Nowhere town", { env: { GEOCODER_URL: "off" }, fetchImpl: impl })).toBeNull();
  });
});

describe("weather alerts", () => {
  it("knows NWS coverage", () => {
    expect(inNwsCoverage(CHI)).toBe(true);
    expect(inNwsCoverage([4.47, 51.92])).toBe(false);
    expect(inNwsCoverage([-157.86, 21.3])).toBe(true);
  });

  it("merges alerts along a path, most severe first, and survives a failed probe", async () => {
    let n = 0;
    const { impl, calls } = fakeFetch({
      "api.weather.gov": () => {
        n += 1;
        if (n === 2) return new Response("busy", { status: 503 });
        return jsonResponse({
          features: n === 1 ? [nwsFeature("a1", "Winter Weather Advisory", "Moderate")] : [nwsFeature("a1", "Winter Weather Advisory", "Moderate"), nwsFeature("a2", "Blizzard Warning", "Severe")],
        });
      },
    });
    const alerts = await alertsAlongPath([[-87.1, 41.1], [-86.1, 41.0], [-85.1, 40.9]], { fetchImpl: impl, env: {} });
    expect(alerts.map((a) => a.event)).toEqual(["Blizzard Warning", "Winter Weather Advisory"]);
    expect(alerts[1].summary).toBe("Heavy snow expected.");
    expect(calls[0].url).toContain("/alerts/active?status=actual&message_type=alert,update&point=41.100,-87.100");
    expect(calls[0].headers.Accept).toBe("application/geo+json");
    expect(await alertsAlongPath([[4.47, 51.92]], { fetchImpl: impl })).toEqual([]);
  });

  it("detects a lane crossing a warning polygon", () => {
    const box: WeatherAlert["geometry"] = { type: "Polygon", coordinates: [[[-86, 40], [-84, 40], [-84, 42], [-86, 42], [-86, 40]]] };
    const alert = { geometry: box } as WeatherAlert;
    expect(pathHitsAlert(greatCircle(CHI, CMH, 40), alert)).toBe(true);
    expect(pathHitsAlert(greatCircle([-118.2, 34], [-112, 33.4], 20), alert)).toBe(false);
    expect(pathHitsAlert([CHI], { geometry: null } as WeatherAlert)).toBe(false);
  });
});

describe("news", () => {
  it("builds a GDELT query for a lane", () => {
    expect(laneNewsQuery([lookupPlace("Chicago, IL"), lookupPlace("Los Angeles, CA")])).toMatch(
      /^\(Chicago OR "Los Angeles"\) \(freight OR .*\) sourcelang:english$/
    );
    expect(toKeywordQuery('(Chicago OR Dallas) (freight OR trucking) sourcelang:english')).toBe("(Chicago OR Dallas) (freight OR trucking)");
    expect(laneNewsQuery([null, null])).toBeNull();
    expect(parseSeenDate("20260708T124500Z")).toBe("2026-07-08T12:45:00Z");
    expect(parseSeenDate("garbage")).toBeNull();
  });

  it("parses, de-duplicates and caches articles", async () => {
    const { impl, calls } = fakeFetch({
      "api.gdeltproject.org": () =>
        jsonResponse({
          articles: [
            { url: "https://news.example/a", title: "I-70 closed after crash", seendate: "20261111T150000Z", domain: "news.example", socialimage: "http://insecure/img.jpg" },
            { url: "https://other.example/a", title: "I-70 closed after crash", seendate: "20261111T150500Z", domain: "other.example" },
            { url: "javascript:alert(1)", title: "bad" },
            { url: "https://port.example/b", title: "Port strike talks resume", seendate: "20261111T120000Z", domain: "port.example" },
          ],
        }),
    });
    const items = await searchNews("test-query-1", { fetchImpl: impl });
    expect(items.map((i) => i.title)).toEqual(["I-70 closed after crash", "Port strike talks resume"]);
    expect(items[0]).toMatchObject({ seenAt: "2026-11-11T15:00:00Z", image: null, domain: "news.example" });
    await searchNews("test-query-1", { fetchImpl: impl });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("mode=artlist&format=json&sort=datedesc");
  });
});

describe("marine alerts and backup news", () => {
  it("recognises lake and offshore alerts by zone, falling back to the event name", () => {
    expect(isMarineAlert("Gale Warning", ["LMZ740", "LMZ742"])).toBe(true);
    expect(isMarineAlert("Winter Storm Warning", ["ILZ014", "LMZ740"])).toBe(false);
    expect(isMarineAlert("Small Craft Advisory", undefined)).toBe(true);
    expect(isMarineAlert("Blizzard Warning", [])).toBe(false);
  });

  it("drops marine alerts on road lanes but keeps them for ocean legs", async () => {
    const feature = (id: string, event: string, ugc: string[]) => ({
      ...nwsFeature(id, event, "Moderate"),
      properties: { ...nwsFeature(id, event, "Moderate").properties, geocode: { UGC: ugc } },
    });
    const { impl } = fakeFetch({
      "api.weather.gov": () => jsonResponse({ features: [feature("m1", "Gale Warning", ["LMZ740"]), feature("l1", "Winter Weather Advisory", ["ILZ014"])] }),
    });
    const road = await routeConditions("Boston, MA", "Buffalo, NY", { fetchImpl: impl, env: {}, includeNews: false, mode: "road" });
    expect(road.alerts.map((a) => a.id)).toEqual(["l1"]);
    const sea = await routeConditions("Boston, MA", "Buffalo, NY", { fetchImpl: impl, env: {}, includeNews: false, mode: "ocean" });
    expect(sea.alerts.map((a) => a.id).sort()).toEqual(["l1", "m1"]);
  });

  it("falls back to Google News RSS when GDELT answers with an error", async () => {
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>I-80 reopens after pileup near Toledo - The Blade</title><link>https://news.google.com/rss/articles/abc</link>
      <pubDate>Wed, 11 Nov 2026 18:00:00 GMT</pubDate><source url="https://www.toledoblade.com">The Blade</source></item>
      <item><title><![CDATA[Port of Newark &amp; rail volumes climb]]></title><link>https://news.google.com/rss/articles/def</link>
      <source url="https://www.joc.com">JOC</source></item>
    </channel></rss>`;
    const { impl, calls } = fakeFetch({
      "api.gdeltproject.org": () => new Response("The specified phrase is too short.", { status: 200 }),
      "news.google.com": () => new Response(rss, { status: 200 }),
    });
    const items = await searchNews("(Newark OR Toledo) (freight OR highway) sourcelang:english", { fetchImpl: impl });
    expect(items.map((i) => [i.title, i.domain, i.provider])).toEqual([
      ["I-80 reopens after pileup near Toledo", "The Blade", "google_news"],
      ["Port of Newark & rail volumes climb", "JOC", "google_news"],
    ]);
    expect(items[0].seenAt).toBe("2026-11-11T18:00:00.000Z");
    expect(decodeURIComponent(calls[1].url)).toContain("q=(Newark OR Toledo) (freight OR highway) when:3d");
    expect(parseNewsRss("<rss></rss>", 5)).toEqual([]);
  });
});

describe("route conditions", () => {
  it("assembles map, alerts and news, and degrades per source", async () => {
    const { impl } = fakeFetch({
      "api.weather.gov": () => jsonResponse({ features: [nwsFeature("w9", "Lake Effect Snow Warning", "Severe")] }),
      "api.gdeltproject.org": () => new Response("Please limit requests to one every 5 seconds", { status: 429 }),
    });
    const c = await routeConditions("Chicago, IL", "Columbus, OH", { fetchImpl: impl, env: {} });
    expect(c.origin?.name).toBe("Chicago, IL");
    expect(c.route?.approximate).toBe(true);
    expect(c.alerts.map((a) => a.event)).toEqual(["Lake Effect Snow Warning"]);
    expect(c.news).toEqual([]);
    expect(c.alertsOk).toBe(true);
    expect(c.newsOk).toBe(false);
    expect(c.issues).toEqual(["News is unavailable right now."]);
    expect(c.radarCoverage).toBe(true);
    expect(c.sources.map((s) => s.id)).toEqual(["openfreemap", "nexrad", "nws", "gdelt"]);
    expect(c.bounds?.[0]).toBeCloseTo(-87.63, 1);
  });

  it("flags places it can't find and skips US-only sources abroad", async () => {
    const { impl } = fakeFetch({ "api.gdeltproject.org": () => jsonResponse({ articles: [] }) });
    const c = await routeConditions("Atlantis", "Rotterdam", { fetchImpl: impl, env: { GEOCODER_URL: "off" } });
    expect(c.origin).toBeNull();
    expect(c.issues).toContain('Couldn\'t place "Atlantis" on the map.');
    expect(c.radarCoverage).toBe(false);
    expect(c.alerts).toEqual([]);
  });

  it("marks lanes that cross nationwide warnings", async () => {
    const poly: WeatherAlert["geometry"] = { type: "Polygon", coordinates: [[[-86, 40], [-84, 40], [-84, 42], [-86, 42], [-86, 40]]] };
    const { impl } = fakeFetch({
      "api.weather.gov": () => jsonResponse({ features: [nwsFeature("n1", "Winter Storm Warning", "Severe", poly), nwsFeature("n2", "Flood Warning", "Severe")] }),
    });
    const net = await networkConditions(
      [
        { shipmentId: "s1", label: "SH-001", origin: "Chicago, IL", destination: "Columbus, OH", tone: "high" },
        { shipmentId: "s2", label: "SH-002", origin: "Los Angeles, CA", destination: "Phoenix, AZ" },
        { shipmentId: "s3", label: "SH-003", origin: "A", destination: "B" },
      ],
      { fetchImpl: impl, env: { GEOCODER_URL: "off" } }
    );
    expect(net.alerts.map((a) => a.id)).toEqual(["n1"]); // polygon-less alerts dropped
    expect(net.lanes.find((l) => l.shipmentId === "s1")?.alertIds).toEqual(["n1"]);
    expect(net.lanes.find((l) => l.shipmentId === "s2")?.alertIds).toEqual([]);
    expect(net.unplaced).toEqual([{ shipmentId: "s3", label: "SH-003" }]);
  });
});

describe("cache helpers", () => {
  it("expires entries and identifies the app politely", async () => {
    let t = 0;
    const cache = new TtlCache<number>(1000, 2, () => t);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    t = 1001;
    expect(cache.get("a")).toBeUndefined();
    cache.set("x", 1);
    cache.set("y", 2);
    cache.set("z", 3);
    expect(cache.get("x")).toBeUndefined();
    expect(publicApiUserAgent({})).toBe("ShippingRiskIntel/1.0");
    expect(publicApiUserAgent({ VERCEL_URL: "app.vercel.app", PUBLIC_DATA_CONTACT: "ops@example.com" })).toBe(
      "ShippingRiskIntel/1.0 (https://app.vercel.app; ops@example.com)"
    );
  });
});

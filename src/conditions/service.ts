import type { FetchLike } from "@/integrations/http";
import { geocode } from "@/geo/geocode";
import { bbox, samplePath, type LngLat } from "@/geo/lane";
import type { Place } from "@/geo/places";
import { laneRoute, type LaneRoute } from "@/geo/route";

import { alertsAlongPath, inNwsCoverage, nationalSevereAlerts, pathHitsAlert, type WeatherAlert } from "./alerts";
import { laneNewsQuery, NETWORK_NEWS_QUERY, searchNews, type NewsItem } from "./news";

/**
 * Route conditions: where a lane runs, what the weather service is warning
 * about along it, and what the news is saying about its endpoints. Every
 * source is free and public; each one fails independently, so a slow news
 * feed never blanks out the map.
 */

export interface SourceNote {
  id: "openfreemap" | "nexrad" | "nws" | "gdelt" | "nominatim" | "osrm";
  label: string;
  url: string;
}

export const SOURCES: Record<SourceNote["id"], SourceNote> = {
  openfreemap: { id: "openfreemap", label: "Map © OpenStreetMap contributors, OpenFreeMap", url: "https://openfreemap.org" },
  nexrad: { id: "nexrad", label: "Radar: NOAA NEXRAD via Iowa Environmental Mesonet", url: "https://mesonet.agron.iastate.edu" },
  nws: { id: "nws", label: "Alerts: National Weather Service", url: "https://www.weather.gov" },
  gdelt: { id: "gdelt", label: "News: The GDELT Project", url: "https://www.gdeltproject.org" },
  nominatim: { id: "nominatim", label: "Places: Nominatim / OpenStreetMap", url: "https://nominatim.org" },
  osrm: { id: "osrm", label: "Roads: OSRM", url: "https://project-osrm.org" },
};

export interface RouteConditions {
  origin: Place | null;
  destination: Place | null;
  route: LaneRoute | null;
  /** [west, south, east, north] to frame the map. */
  bounds: [number, number, number, number] | null;
  alerts: WeatherAlert[];
  /** false when the alert feed failed — never read an empty list as "all clear". */
  alertsOk: boolean;
  news: NewsItem[];
  newsOk: boolean;
  /** Radar only covers the US; tells the UI whether to offer it. */
  radarCoverage: boolean;
  /** Per-source problems, phrased for people. */
  issues: string[];
  sources: SourceNote[];
  fetchedAt: string;
}

export interface ConditionsOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
  includeNews?: boolean;
}

export async function routeConditions(
  originText: string | null | undefined,
  destinationText: string | null | undefined,
  opts: ConditionsOptions = {}
): Promise<RouteConditions> {
  const issues: string[] = [];
  const [origin, destination] = await Promise.all([
    geocode(originText, opts),
    geocode(destinationText, opts),
  ]);
  if (originText && !origin) issues.push(`Couldn't place "${originText}" on the map.`);
  if (destinationText && !destination) issues.push(`Couldn't place "${destinationText}" on the map.`);

  let route: LaneRoute | null = null;
  if (origin && destination) {
    route = await laneRoute([origin.lon, origin.lat], [destination.lon, destination.lat], opts);
  }
  const keyPoints: LngLat[] = route
    ? route.path
    : [origin, destination].filter((p): p is Place => p !== null).map((p) => [p.lon, p.lat]);

  const probes = route ? samplePath(route.path, 120, 10) : keyPoints;
  const [alertsResult, newsResult] = await Promise.allSettled([
    alertsAlongPath(probes, opts),
    opts.includeNews === false
      ? Promise.resolve<NewsItem[]>([])
      : (() => {
          const q = laneNewsQuery([origin, destination]);
          return q ? searchNews(q, { timespan: "3d", max: 8, fetchImpl: opts.fetchImpl }) : Promise.resolve([]);
        })(),
  ]);

  const alerts = alertsResult.status === "fulfilled" ? alertsResult.value : [];
  if (alertsResult.status === "rejected") issues.push("Weather alerts are unavailable right now.");
  const news = newsResult.status === "fulfilled" ? newsResult.value : [];
  if (newsResult.status === "rejected") issues.push("News is unavailable right now.");

  const radarCoverage = keyPoints.some(inNwsCoverage);
  const sources = [SOURCES.openfreemap];
  if (radarCoverage) sources.push(SOURCES.nexrad, SOURCES.nws);
  if (opts.includeNews !== false) sources.push(SOURCES.gdelt);
  if (route?.source === "osrm") sources.push(SOURCES.osrm);

  return {
    origin,
    destination,
    route,
    bounds: keyPoints.length ? bbox(keyPoints) : null,
    alerts,
    alertsOk: alertsResult.status === "fulfilled",
    news,
    newsOk: newsResult.status === "fulfilled",
    radarCoverage,
    issues,
    sources,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- network

export interface NetworkLaneInput {
  shipmentId: string;
  label: string;
  origin: string | null | undefined;
  destination: string | null | undefined;
  /** Optional risk tone for colouring the lane. */
  tone?: "low" | "elevated" | "high" | null;
}

export interface NetworkLane {
  shipmentId: string;
  label: string;
  originName: string;
  destinationName: string;
  path: LngLat[];
  tone: "low" | "elevated" | "high" | null;
  /** Ids of national warnings whose polygon the lane crosses. */
  alertIds: string[];
}

export interface NetworkConditions {
  lanes: NetworkLane[];
  unplaced: { shipmentId: string; label: string }[];
  alerts: WeatherAlert[];
  alertsOk: boolean;
  bounds: [number, number, number, number] | null;
  issues: string[];
  sources: SourceNote[];
  fetchedAt: string;
}

/** Every lane on one map, plus nationwide severe warnings and which lanes they hit. */
export async function networkConditions(
  inputs: NetworkLaneInput[],
  opts: ConditionsOptions = {}
): Promise<NetworkConditions> {
  const issues: string[] = [];
  const placed = await Promise.all(
    inputs.map(async (input) => {
      const [o, d] = await Promise.all([geocode(input.origin, opts), geocode(input.destination, opts)]);
      if (!o || !d) return { input, lane: null };
      const route = await laneRoute([o.lon, o.lat], [d.lon, d.lat], { ...opts, roadMode: false });
      return { input, lane: { o, d, path: route.path } };
    })
  );

  let alerts: WeatherAlert[] = [];
  let alertsOk = true;
  try {
    alerts = await nationalSevereAlerts(opts);
  } catch {
    alertsOk = false;
    issues.push("Nationwide weather warnings are unavailable right now.");
  }

  const lanes: NetworkLane[] = [];
  const unplaced: NetworkConditions["unplaced"] = [];
  for (const { input, lane } of placed) {
    if (!lane) {
      unplaced.push({ shipmentId: input.shipmentId, label: input.label });
      continue;
    }
    const probes = samplePath(lane.path, 40, 40);
    lanes.push({
      shipmentId: input.shipmentId,
      label: input.label,
      originName: lane.o.name,
      destinationName: lane.d.name,
      path: lane.path,
      tone: input.tone ?? null,
      alertIds: alerts.filter((a) => pathHitsAlert(probes, a)).map((a) => a.id),
    });
  }

  const allPoints = lanes.flatMap((l) => [l.path[0], l.path[l.path.length - 1]]);
  return {
    lanes,
    unplaced,
    alerts,
    alertsOk,
    bounds: allPoints.length ? bbox(allPoints) : null,
    issues,
    sources: [SOURCES.openfreemap, SOURCES.nexrad, SOURCES.nws, SOURCES.gdelt],
    fetchedAt: new Date().toISOString(),
  };
}

export async function networkNews(opts: { fetchImpl?: FetchLike } = {}): Promise<NewsItem[]> {
  return searchNews(NETWORK_NEWS_QUERY, { timespan: "2d", max: 12, fetchImpl: opts.fetchImpl });
}

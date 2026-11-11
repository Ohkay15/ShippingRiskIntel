import { requestJson, type FetchLike } from "@/integrations/http";

import { TtlCache } from "./cache";
import { greatCircle, pathLengthKm, type LngLat } from "./lane";

/**
 * Road geometry for a lane. Free by default: the great-circle line,
 * labelled approximate. If ROUTING_URL points at a self-hosted OSRM
 * (open source, free to run), we ask it for the real driving route.
 *
 * We deliberately don't call the public OSRM demo server: its policy
 * rules out production use and use behind a login.
 */

export interface LaneRoute {
  path: LngLat[];
  distanceKm: number;
  /** Hours of driving, when a router supplied it. */
  durationH: number | null;
  /** true = straight great-circle line, not a road route. */
  approximate: boolean;
  source: "great_circle" | "osrm";
}

const cache = new TtlCache<LaneRoute>(12 * 60 * 60 * 1000, 500);

interface OsrmResponse {
  code: string;
  routes?: { distance: number; duration: number; geometry: { coordinates: LngLat[] } }[];
}

export async function laneRoute(
  from: LngLat,
  to: LngLat,
  opts: { env?: Record<string, string | undefined>; fetchImpl?: FetchLike; roadMode?: boolean } = {}
): Promise<LaneRoute> {
  const fallback = (): LaneRoute => {
    const path = greatCircle(from, to, 64);
    return { path, distanceKm: pathLengthKm(path), durationH: null, approximate: true, source: "great_circle" };
  };
  const env = opts.env ?? process.env;
  const base = env.ROUTING_URL?.trim().replace(/\/$/, "");
  if (!base || opts.roadMode === false) return fallback();

  const key = `${base}|${from.join(",")}|${to.join(",")}`;
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    {
      const url = `${base}/route/v1/driving/${from.join(",")};${to.join(",")}?overview=simplified&geometries=geojson`;
      const res = await requestJson<OsrmResponse>({ connectorId: "osrm", url, timeoutMs: 8000, fetchImpl: opts.fetchImpl });
      const route = res.routes?.[0];
      if (res.code !== "Ok" || !route || route.geometry.coordinates.length < 2) return fallback();
      const result: LaneRoute = {
        path: route.geometry.coordinates,
        distanceKm: route.distance / 1000,
        durationH: route.duration / 3600,
        approximate: false,
        source: "osrm",
      };
      cache.set(key, result); // only real routes are cached; failures retry next time
      return result;
    }
  } catch {
    return fallback();
  }
}

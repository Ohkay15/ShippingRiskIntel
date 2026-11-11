import { requestJson, type FetchLike } from "@/integrations/http";
import { TtlCache, publicApiUserAgent } from "@/geo/cache";
import type { LngLat } from "@/geo/lane";

/**
 * Active weather alerts from the US National Weather Service
 * (api.weather.gov) — free, public domain, no key; the NWS asks for a
 * descriptive User-Agent. US coverage only.
 */

const NWS = "https://api.weather.gov";

export type AlertSeverity = "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";

export interface WeatherAlert {
  id: string;
  event: string;
  severity: AlertSeverity;
  headline: string;
  area: string;
  /** ISO timestamps */
  onset: string | null;
  ends: string | null;
  sender: string;
  /** Trimmed description, plain text. */
  summary: string;
  instruction: string | null;
  /** Polygon(s) when the NWS supplies one; zone-based alerts have none. */
  geometry: GeoJsonPolygonish | null;
}

export type GeoJsonPolygonish =
  | { type: "Polygon"; coordinates: LngLat[][] }
  | { type: "MultiPolygon"; coordinates: LngLat[][][] };

interface NwsFeature {
  id: string;
  geometry: GeoJsonPolygonish | null;
  properties: {
    id?: string;
    event?: string;
    severity?: string;
    headline?: string | null;
    areaDesc?: string;
    onset?: string | null;
    effective?: string | null;
    ends?: string | null;
    expires?: string | null;
    senderName?: string;
    description?: string | null;
    instruction?: string | null;
    status?: string;
    messageType?: string;
  };
}
interface NwsCollection {
  features?: NwsFeature[];
}

const SEVERITY_ORDER: AlertSeverity[] = ["Extreme", "Severe", "Moderate", "Minor", "Unknown"];
export const severityRank = (s: AlertSeverity) => SEVERITY_ORDER.indexOf(s);

function toAlert(f: NwsFeature): WeatherAlert {
  const p = f.properties ?? {};
  const severity = (SEVERITY_ORDER as string[]).includes(p.severity ?? "")
    ? (p.severity as AlertSeverity)
    : "Unknown";
  const description = (p.description ?? "").replace(/\s+/g, " ").trim();
  return {
    id: p.id ?? f.id,
    event: p.event ?? "Weather alert",
    severity,
    headline: p.headline ?? p.event ?? "Weather alert",
    area: p.areaDesc ?? "",
    onset: p.onset ?? p.effective ?? null,
    ends: p.ends ?? p.expires ?? null,
    sender: p.senderName ?? "National Weather Service",
    summary: description.length > 480 ? `${description.slice(0, 477)}…` : description,
    instruction: p.instruction ? p.instruction.replace(/\s+/g, " ").trim().slice(0, 300) : null,
    geometry: f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon") ? f.geometry : null,
  };
}

/** Rough US bounds (CONUS, Alaska, Hawaii, Puerto Rico) — NWS covers nothing else. */
export function inNwsCoverage([lon, lat]: LngLat): boolean {
  const conus = lat >= 24 && lat <= 50 && lon >= -125.5 && lon <= -66;
  const alaska = lat >= 51 && lat <= 72 && lon >= -180 && lon <= -129;
  const hawaii = lat >= 18.5 && lat <= 22.5 && lon >= -161 && lon <= -154;
  const pr = lat >= 17.8 && lat <= 18.6 && lon >= -67.4 && lon <= -65.2;
  return conus || alaska || hawaii || pr;
}

const pointCache = new TtlCache<WeatherAlert[]>(5 * 60 * 1000, 2000);
const nationalCache = new TtlCache<WeatherAlert[]>(5 * 60 * 1000, 4);

interface Opts {
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
}

function headers(env: Record<string, string | undefined>) {
  return { "User-Agent": publicApiUserAgent(env), Accept: "application/geo+json" };
}

async function alertsAtPoint(point: LngLat, opts: Opts): Promise<WeatherAlert[]> {
  const env = opts.env ?? process.env;
  const lat = point[1].toFixed(3);
  const lon = point[0].toFixed(3);
  return pointCache.getOrLoad(`${lat},${lon}`, async () => {
    const res = await requestJson<NwsCollection>({
      connectorId: "nws_alerts",
      url: `${NWS}/alerts/active?status=actual&message_type=alert,update&point=${lat},${lon}`,
      headers: headers(env),
      timeoutMs: 7000,
      fetchImpl: opts.fetchImpl,
    });
    return (res.features ?? []).map(toAlert);
  });
}

function sortAlerts(alerts: WeatherAlert[]): WeatherAlert[] {
  return alerts.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || (a.onset ?? "").localeCompare(b.onset ?? ""));
}

/**
 * Alerts covering any probe point along a lane, de-duplicated, most
 * severe first. Probes outside NWS coverage are skipped. Throws only if
 * every probe failed.
 */
export async function alertsAlongPath(points: LngLat[], opts: Opts = {}): Promise<WeatherAlert[]> {
  const probes = points.filter(inNwsCoverage);
  if (probes.length === 0) return [];
  const results = await Promise.allSettled(probes.map((p) => alertsAtPoint(p, opts)));
  const ok = results.filter((r): r is PromiseFulfilledResult<WeatherAlert[]> => r.status === "fulfilled");
  if (ok.length === 0) {
    const first = results[0] as PromiseRejectedResult;
    throw first.reason;
  }
  const byId = new Map<string, WeatherAlert>();
  for (const r of ok) for (const alert of r.value) byId.set(alert.id, alert);
  return sortAlerts([...byId.values()]);
}

/** Nationwide Severe/Extreme warnings that carry a polygon — for the network map. */
export async function nationalSevereAlerts(opts: Opts = {}): Promise<WeatherAlert[]> {
  const env = opts.env ?? process.env;
  return nationalCache.getOrLoad("severe", async () => {
    const res = await requestJson<NwsCollection>({
      connectorId: "nws_alerts",
      url: `${NWS}/alerts/active?status=actual&message_type=alert,update&severity=Extreme,Severe`,
      headers: headers(env),
      timeoutMs: 10000,
      fetchImpl: opts.fetchImpl,
    });
    return sortAlerts((res.features ?? []).map(toAlert).filter((a) => a.geometry !== null));
  });
}

function inRing([x, y]: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(point: LngLat, rings: LngLat[][]): boolean {
  if (rings.length === 0 || !inRing(point, rings[0])) return false;
  return !rings.slice(1).some((hole) => inRing(point, hole));
}

/** Does any point of the path fall inside the alert's polygon? */
export function pathHitsAlert(path: LngLat[], alert: WeatherAlert): boolean {
  const g = alert.geometry;
  if (!g) return false;
  const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return path.some((pt) => polygons.some((rings) => inPolygon(pt, rings)));
}

/**
 * Lane geometry without a routing service: the great-circle line between
 * origin and destination, sampled into points. It's an honest "as the
 * crow flies" lane — the UI labels it approximate — and it's what we use
 * to look up weather alerts along the way. A self-hosted OSRM (see
 * route.ts) replaces it with real road geometry.
 */

export type LngLat = [lon: number, lat: number];

const R_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distanceKm(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Points along the great circle from a to b, inclusive, `segments` + 1 of them. */
export function greatCircle(a: LngLat, b: LngLat, segments = 64): LngLat[] {
  const [lon1, lat1] = [rad(a[0]), rad(a[1])];
  const [lon2, lat2] = [rad(b[0]), rad(b[1])];
  const d = distanceKm(a, b) / R_KM;
  if (d === 0) return [a, b];
  const out: LngLat[] = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    out.push([deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }
  return out;
}

/**
 * Pick points along a path roughly every `everyKm`, always including both
 * ends, capped at `max` — the probe points for alert lookups.
 */
export function samplePath(path: LngLat[], everyKm = 120, max = 10): LngLat[] {
  if (path.length <= 2) return path.slice();
  const picked: LngLat[] = [path[0]];
  let run = 0;
  for (let i = 1; i < path.length - 1; i++) {
    run += distanceKm(path[i - 1], path[i]);
    if (run >= everyKm) {
      picked.push(path[i]);
      run = 0;
    }
  }
  picked.push(path[path.length - 1]);
  if (picked.length <= max) return picked;
  // Thin evenly, keeping both ends.
  const out: LngLat[] = [];
  for (let i = 0; i < max; i++) out.push(picked[Math.round((i * (picked.length - 1)) / (max - 1))]);
  return out;
}

export function pathLengthKm(path: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += distanceKm(path[i - 1], path[i]);
  return total;
}

/** [west, south, east, north] */
export function bbox(points: LngLat[]): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lon, lat] of points) {
    w = Math.min(w, lon); e = Math.max(e, lon);
    s = Math.min(s, lat); n = Math.max(n, lat);
  }
  return [w, s, e, n];
}

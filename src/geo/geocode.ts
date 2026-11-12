import { requestJson, type FetchLike } from "@/integrations/http";

import { TtlCache, publicApiUserAgent } from "./cache";
import { lookupPlace, type Place } from "./places";

/**
 * Turn a free-text location ("Chicago, IL", "Port of Savannah") into
 * coordinates. Built-in gazetteer first; anything else goes to
 * OpenStreetMap's public Nominatim geocoder (free, no key) with a
 * descriptive User-Agent, results cached for a day. Set
 * GEOCODER_URL to point at a self-hosted Nominatim instead, or
 * GEOCODER_URL=off to use the built-in list only.
 */

const DEFAULT_GEOCODER = "https://nominatim.openstreetmap.org";
const cache = new TtlCache<Place | null>(24 * 60 * 60 * 1000, 1000);

interface NominatimHit {
  lat: string;
  lon: string;
  display_name: string;
  address?: { state?: string; country_code?: string; "ISO3166-2-lvl4"?: string };
}

export interface GeocodeOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
}

export async function geocode(text: string | null | undefined, opts: GeocodeOptions = {}): Promise<Place | null> {
  const local = lookupPlace(text);
  if (local) return local;
  const query = text?.trim();
  if (!query || query.length < 2) return null;

  const env = opts.env ?? process.env;
  const base = (env.GEOCODER_URL?.trim() || DEFAULT_GEOCODER).replace(/\/$/, "");
  if (base === "off") return null;

  return cache.getOrLoad(`${base}|${query.toLowerCase()}`, async () => {
    try {
      const url = `${base}/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(query)}`;
      const hits = await requestJson<NominatimHit[]>({
        connectorId: "nominatim",
        url,
        headers: { "User-Agent": publicApiUserAgent(env), "Accept-Language": "en" },
        timeoutMs: 6000,
        fetchImpl: opts.fetchImpl,
      });
      const hit = hits[0];
      if (!hit) return null;
      const lat = Number(hit.lat);
      const lon = Number(hit.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const iso = hit.address?.["ISO3166-2-lvl4"];
      return {
        name: query,
        lat,
        lon,
        region: iso?.split("-")[1] ?? "",
        country: (hit.address?.country_code ?? "").toUpperCase(),
      };
    } catch {
      return null; // geocoder down: the map just shows what it can
    }
  });
}

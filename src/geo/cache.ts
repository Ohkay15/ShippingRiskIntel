/**
 * Tiny in-memory TTL cache shared by the free public data sources. Public
 * services (Nominatim, NWS, GDELT) ask callers to cache and to stay well
 * under their rate limits; this keeps repeat page loads off the network.
 * Per-instance only — good enough at this volume, and nothing here is
 * user data.
 */
export class TtlCache<V> {
  private store = new Map<string, { value: V; expires: number }>();

  constructor(
    private ttlMs: number,
    private maxEntries = 500,
    private now: () => number = Date.now
  ) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: this.now() + this.ttlMs });
  }

  /** Return the cached value or compute, cache and return it. */
  async getOrLoad(key: string, load: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await load();
    this.set(key, value);
    return value;
  }
}

/** Identify ourselves to public APIs, as their usage policies require. */
export function publicApiUserAgent(env: Record<string, string | undefined> = process.env): string {
  const site = env.APP_URL?.trim() || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "");
  const contact = env.PUBLIC_DATA_CONTACT?.trim();
  const detail = [site, contact].filter(Boolean).join("; ");
  return detail ? `ShippingRiskIntel/1.0 (${detail})` : "ShippingRiskIntel/1.0";
}

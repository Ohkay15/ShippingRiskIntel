/**
 * Fair-use limits on the two features that spend money on every call (the
 * AI assistant and AI document extraction). They matter most in open mode,
 * where anyone with the link can use the app. Fixed windows, in memory per
 * server instance — enough to stop a runaway script or a curious crowd
 * from running up the model bill. Tunable with env vars.
 */

interface Window {
  count: number;
  resetAt: number;
}

export interface LimitRule {
  /** Max calls per key per window. */
  perKey: number;
  /** Max calls across everyone per window, per instance. */
  global: number;
  windowMs: number;
}

export class UsageLimiter {
  private perKey = new Map<string, Window>();
  private global: Window = { count: 0, resetAt: 0 };

  constructor(
    private rule: LimitRule,
    private now: () => number = Date.now
  ) {}

  private bump(w: Window | undefined): Window {
    const t = this.now();
    if (!w || w.resetAt <= t) return { count: 1, resetAt: t + this.rule.windowMs };
    return { count: w.count + 1, resetAt: w.resetAt };
  }

  /** Records a call; returns ok=false (and does not count it) when over a limit. */
  take(key: string): { ok: true } | { ok: false; retryAfterS: number } {
    const t = this.now();
    const nextKey = this.bump(this.perKey.get(key));
    const nextGlobal = this.bump(this.global.resetAt > t ? this.global : undefined);
    if (nextKey.count > this.rule.perKey) return { ok: false, retryAfterS: Math.ceil((nextKey.resetAt - t) / 1000) };
    if (nextGlobal.count > this.rule.global) return { ok: false, retryAfterS: Math.ceil((nextGlobal.resetAt - t) / 1000) };
    if (this.perKey.size > 5000) this.perKey.clear(); // bounded memory
    this.perKey.set(key, nextKey);
    this.global = nextGlobal;
    return { ok: true };
  }
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const HOUR = 60 * 60 * 1000;
const env = process.env;

/** Assistant messages: 40 per visitor per hour, 400 per hour overall. */
export const assistantLimiter = new UsageLimiter({
  perKey: num(env.ASSISTANT_LIMIT_PER_HOUR, 40),
  global: num(env.ASSISTANT_LIMIT_GLOBAL_PER_HOUR, 400),
  windowMs: HOUR,
});

/** Document extraction runs: 15 per visitor per hour, 100 per hour overall. */
export const extractionLimiter = new UsageLimiter({
  perKey: num(env.EXTRACTION_LIMIT_PER_HOUR, 15),
  global: num(env.EXTRACTION_LIMIT_GLOBAL_PER_HOUR, 100),
  windowMs: HOUR,
});

/** Best-effort visitor key: the client IP from the proxy headers. */
export function visitorKey(h: { get(name: string): string | null }): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export function limitMessage(retryAfterS: number): string {
  const mins = Math.max(1, Math.ceil(retryAfterS / 60));
  return `You've hit the usage limit for now. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`;
}

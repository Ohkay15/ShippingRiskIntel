import { describe, expect, it } from "vitest";

import { ACCOUNT_ONLY_PATHS, GUEST_USER, signInRequired } from "./mode";
import { UsageLimiter, limitMessage, visitorKey } from "./usage-limit";

describe("access mode", () => {
  it("is open unless REQUIRE_SIGN_IN=true", () => {
    expect(signInRequired({})).toBe(false);
    expect(signInRequired({ REQUIRE_SIGN_IN: "false" })).toBe(false);
    expect(signInRequired({ REQUIRE_SIGN_IN: " TRUE " })).toBe(true);
    expect(GUEST_USER.role).toBe("member");
    expect(ACCOUNT_ONLY_PATHS).toContain("/settings");
  });
});

describe("usage limits", () => {
  it("caps each visitor and everyone, then resets", () => {
    let t = 0;
    const limiter = new UsageLimiter({ perKey: 2, global: 3, windowMs: 1000 }, () => t);
    expect(limiter.take("a").ok).toBe(true);
    expect(limiter.take("a").ok).toBe(true);
    const third = limiter.take("a");
    expect(third.ok).toBe(false);
    expect(third.ok === false && third.retryAfterS).toBe(1);
    expect(limiter.take("b").ok).toBe(true); // global now 3
    expect(limiter.take("c").ok).toBe(false); // global cap
    t = 1001;
    expect(limiter.take("a").ok).toBe(true);
  });

  it("keys visitors by forwarded IP and phrases the wait", () => {
    const h = (v: Record<string, string>) => ({ get: (n: string) => v[n] ?? null });
    expect(visitorKey(h({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(visitorKey(h({}))).toBe("unknown");
    expect(limitMessage(30)).toContain("about 1 minute");
    expect(limitMessage(600)).toContain("10 minutes");
  });
});

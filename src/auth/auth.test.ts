import { describe, expect, it } from "vitest";

import { isPublicPath, safeNextPath } from "./constants";
import { hashPassword, passwordProblem, verifyPassword } from "./password";
import { afterFailedSignIn, MAX_FAILED_SIGN_INS, normalizeEmail, signupDecision, signupMode } from "./policy";
import { looksLikeApiKey, newApiKey, newToken, sha256 } from "./tokens";

describe("passwords", () => {
  it("hashes with a fresh salt and verifies only the right password", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("correct horse batterY", a)).toBe(false);
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });

  it("enforces length", () => {
    expect(passwordProblem("short")).toMatch(/at least 10/);
    expect(passwordProblem("x".repeat(201))).toMatch(/at most/);
    expect(passwordProblem("long enough pw")).toBeNull();
  });
});

describe("tokens and API keys", () => {
  it("issues unguessable tokens and stores only digests", () => {
    expect(newToken()).not.toBe(newToken());
    expect(newToken().length).toBeGreaterThanOrEqual(43);
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("API keys carry a recognizable prefix and hash to their stored digest", () => {
    const { key, prefix, hash } = newApiKey();
    expect(looksLikeApiKey(key)).toBe(true);
    expect(key.startsWith(prefix)).toBe(true);
    expect(hash).toBe(sha256(key));
    expect(looksLikeApiKey("sri_short")).toBe(false);
    expect(looksLikeApiKey("Bearer something-else-entirely")).toBe(false);
  });
});

describe("sign-up policy", () => {
  const base = { inviteCode: undefined, providedCode: undefined, openSignup: false };

  it("makes the first account the owner, whatever else is set", () => {
    expect(signupDecision({ ...base, userCount: 0 })).toEqual({ allowed: true, role: "owner" });
    expect(signupMode({ userCount: 0, inviteCode: "x", openSignup: false })).toBe("first_account");
  });

  it("is closed by default after the first account", () => {
    expect(signupDecision({ ...base, userCount: 1 })).toMatchObject({ allowed: false });
    expect(signupMode({ userCount: 1, inviteCode: undefined, openSignup: false })).toBe("closed");
  });

  it("admits members with the right invite code only", () => {
    const withCode = { ...base, userCount: 3, inviteCode: "harbor-2026" };
    expect(signupDecision({ ...withCode, providedCode: " harbor-2026 " })).toEqual({ allowed: true, role: "member" });
    expect(signupDecision({ ...withCode, providedCode: "harbor-2025" })).toMatchObject({ allowed: false });
    expect(signupDecision({ ...withCode })).toMatchObject({ allowed: false });
  });

  it("open sign-up admits anyone as a member", () => {
    expect(signupDecision({ ...base, userCount: 5, openSignup: true })).toEqual({ allowed: true, role: "member" });
  });

  it("normalizes emails", () => {
    expect(normalizeEmail("  Omkar@Example.COM ")).toBe("omkar@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });

  it("locks after repeated failures and resets the counter", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    expect(afterFailedSignIn(0, now)).toEqual({ failed: 1, lockedUntil: null });
    const tripped = afterFailedSignIn(MAX_FAILED_SIGN_INS - 1, now);
    expect(tripped.failed).toBe(0);
    expect(tripped.lockedUntil!.getTime() - now.getTime()).toBe(15 * 60_000);
  });
});

describe("routing guards", () => {
  it("knows which paths skip the session gate", () => {
    expect(isPublicPath("/sign-in")).toBe(true);
    expect(isPublicPath("/sign-up")).toBe(true);
    expect(isPublicPath("/api/mcp")).toBe(true);
    expect(isPublicPath("/api/integrations/inbound")).toBe(true);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/api/agent")).toBe(false);
    expect(isPublicPath("/sign-inx")).toBe(false);
  });

  it("only allows same-site post-sign-in redirects", () => {
    expect(safeNextPath("/shipments/abc?x=1")).toBe("/shipments/abc?x=1");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("/sign-in")).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
  });
});

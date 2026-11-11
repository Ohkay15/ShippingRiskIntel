/**
 * Auth constants safe to import anywhere — including middleware, which runs
 * where Node APIs and the database are unavailable.
 */
export const SESSION_COOKIE = "sri_session";
export const SESSION_TTL_DAYS = 30;
export const API_KEY_PREFIX = "sri_";

/** Paths reachable without a session. */
export const PUBLIC_PATHS = ["/sign-in", "/sign-up"] as const;

/** API routes that authenticate themselves (bearer secrets), not by session. */
export const SELF_AUTHENTICATED_API = ["/api/integrations/inbound", "/api/mcp"] as const;

export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    SELF_AUTHENTICATED_API.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  );
}

/** Only same-site relative paths survive as a post-sign-in destination. */
export function safeNextPath(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (isPublicPath(raw.split("?")[0]!)) return "/";
  return raw;
}

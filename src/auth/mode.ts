/**
 * Access mode. By default the app is OPEN: anyone with the link uses it
 * without an account (a shared workspace — good for demos and pilots).
 * Set REQUIRE_SIGN_IN=true to turn accounts back on; everything built for
 * accounts (sign-up, sessions, settings) switches back on with it.
 *
 * No database or Next.js imports here, so middleware can use it.
 */
export function signInRequired(env: Record<string, string | undefined> = process.env): boolean {
  return env.REQUIRE_SIGN_IN?.trim().toLowerCase() === "true";
}

/** Who "you" are in open mode. Never stored; has no permissions of its own. */
export const GUEST_USER = Object.freeze({
  id: "guest",
  email: "",
  name: "Guest",
  role: "member" as const,
});

/** Paths that only make sense with accounts; open mode sends them home. */
export const ACCOUNT_ONLY_PATHS = ["/sign-in", "/sign-up", "/settings"];

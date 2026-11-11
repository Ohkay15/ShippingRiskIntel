import { timingSafeEqual } from "node:crypto";

/**
 * Who may create an account. Secure by default: the very first account
 * becomes the workspace owner; after that, sign-up needs the invite code
 * (SIGNUP_CODE) unless the operator explicitly opens it
 * (ALLOW_OPEN_SIGNUP=true). With neither set, sign-up is closed.
 */

export type SignupDecision =
  | { allowed: true; role: "owner" | "member" }
  | { allowed: false; reason: string };

function codesMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given.trim());
  const b = Buffer.from(expected.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signupDecision(input: {
  userCount: number;
  inviteCode: string | undefined;
  providedCode: string | undefined;
  openSignup: boolean;
}): SignupDecision {
  if (input.userCount === 0) return { allowed: true, role: "owner" };
  if (input.openSignup) return { allowed: true, role: "member" };
  if (input.inviteCode) {
    if (input.providedCode && codesMatch(input.providedCode, input.inviteCode)) {
      return { allowed: true, role: "member" };
    }
    return { allowed: false, reason: "That invite code is not valid. Ask the workspace owner for the current code." };
  }
  return { allowed: false, reason: "Sign-ups are closed. Ask the workspace owner to invite you." };
}

/** What the sign-up page should ask for, before anyone submits. */
export function signupMode(input: { userCount: number; inviteCode: string | undefined; openSignup: boolean }):
  | "first_account"
  | "open"
  | "invite"
  | "closed" {
  if (input.userCount === 0) return "first_account";
  if (input.openSignup) return "open";
  if (input.inviteCode) return "invite";
  return "closed";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

export const MAX_FAILED_SIGN_INS = 8;
export const LOCKOUT_MINUTES = 15;

/** After a failed attempt: the new counter and, when it trips, a lock-until time. */
export function afterFailedSignIn(failed: number, now: Date): { failed: number; lockedUntil: Date | null } {
  const next = failed + 1;
  return next >= MAX_FAILED_SIGN_INS
    ? { failed: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) }
    : { failed: next, lockedUntil: null };
}

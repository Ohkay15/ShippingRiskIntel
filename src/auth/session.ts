import { and, eq, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/db";
import { apiKeys, sessions, users } from "@/db/schema";
import { SESSION_COOKIE, SESSION_TTL_DAYS } from "./constants";
import { looksLikeApiKey, newToken, sha256 } from "./tokens";
import { userForSessionToken, type SessionUser } from "./session-store";

export type CurrentUser = SessionUser;

/** Secure cookies on https (Vercel); plain http only for local development. */
async function isHttpsRequest(): Promise<boolean> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto) return proto === "https";
  const host = h.get("host") ?? "";
  return !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

/** Start a session for `userId` and set its cookie (server actions / route handlers only). */
export async function createSession(userId: string): Promise<void> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: await isHttpsRequest(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** The signed-in user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  return userForSessionToken(jar.get(SESSION_COOKIE)?.value);
});

/** For pages and server actions: the user, or a redirect to sign-in. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

/** Ends this browser's session (other devices stay signed in). */
export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

/** Signs out every device for a user — used after a password change. */
export async function destroyAllSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Resolve a personal API key from an Authorization header; records last use. */
export async function userFromApiKey(authorization: string | null): Promise<CurrentUser | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  const key = authorization.slice("Bearer ".length).trim();
  if (!looksLikeApiKey(key)) return null;
  const [row] = await db
    .select({ keyId: apiKeys.id, id: users.id, email: users.email, name: users.name, role: users.role })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(and(eq(apiKeys.keyHash, sha256(key)), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.keyId));
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

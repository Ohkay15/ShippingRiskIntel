import { and, eq, gt } from "drizzle-orm";

import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { sha256 } from "./tokens";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "owner" | "member";
}

/**
 * Look up a raw session token. No Next request APIs here, so both the
 * middleware and server components can call it.
 */
export async function userForSessionToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

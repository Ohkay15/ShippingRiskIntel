"use server";

import { and, count, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { apiKeys, users } from "@/db/schema";
import { safeNextPath } from "@/auth/constants";
import { dummyPasswordHash, hashPassword, passwordProblem, verifyPassword } from "@/auth/password";
import { afterFailedSignIn, normalizeEmail, signupDecision } from "@/auth/policy";
import {
  createSession,
  destroyAllSessions,
  destroyCurrentSession,
  requireUser,
} from "@/auth/session";
import { newApiKey } from "@/auth/tokens";
import { envValue, processEnv } from "@/integrations/status";
import type { AuthFormState, ApiKeyFormState } from "@/auth/form-state";

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const name = field(formData, "name").trim();
  const email = normalizeEmail(field(formData, "email"));
  const password = field(formData, "password");
  const values = { name, email: field(formData, "email").trim(), inviteCode: field(formData, "inviteCode") };
  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = "Enter your name.";
  if (name.length > 120) fieldErrors.name = "Use 120 characters or fewer.";
  if (!email) fieldErrors.email = "Enter a valid email address.";
  const pwProblem = passwordProblem(password);
  if (pwProblem) fieldErrors.password = pwProblem;
  if (Object.keys(fieldErrors).length) return { status: "error", message: null, fieldErrors, values };

  const env = processEnv();
  const [{ value: userCount }] = await db.select({ value: count() }).from(users);
  const decision = signupDecision({
    userCount,
    inviteCode: envValue(env, "SIGNUP_CODE"),
    providedCode: field(formData, "inviteCode") || undefined,
    openSignup: envValue(env, "ALLOW_OPEN_SIGNUP") === "true",
  });
  if (!decision.allowed) return { status: "error", message: decision.reason, fieldErrors: {}, values };

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email!)).limit(1);
  if (existing) {
    return {
      status: "error",
      message: null,
      fieldErrors: { email: "An account with this email already exists. Sign in instead." },
      values,
    };
  }

  const [created] = await db
    .insert(users)
    .values({ name, email: email!, passwordHash: await hashPassword(password), role: decision.role })
    .returning({ id: users.id });
  await createSession(created.id);
  redirect("/");
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = normalizeEmail(field(formData, "email"));
  const password = field(formData, "password");
  const next = safeNextPath(field(formData, "next"));
  const values = { email: field(formData, "email").trim() };
  const generic: AuthFormState = { status: "error", message: "Email or password is incorrect.", fieldErrors: {}, values };
  const locked: AuthFormState = { status: "error", message: "Too many attempts. Try again in a few minutes.", fieldErrors: {}, values };

  const [user] = email
    ? await db
        .select({ id: users.id, passwordHash: users.passwordHash, failed: users.failedSignIns, lockedUntil: users.lockedUntil })
        .from(users)
        .where(eq(users.email, email))
        .limit(1)
    : [];

  if (!user) {
    await verifyPassword(password, await dummyPasswordHash()); // equal timing for unknown emails
    return generic;
  }
  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) return locked;
  if (!(await verifyPassword(password, user.passwordHash))) {
    const failure = afterFailedSignIn(user.failed, now);
    await db.update(users).set({ failedSignIns: failure.failed, lockedUntil: failure.lockedUntil }).where(eq(users.id, user.id));
    return failure.lockedUntil ? locked : generic;
  }

  await db.update(users).set({ failedSignIns: 0, lockedUntil: null }).where(eq(users.id, user.id));
  await createSession(user.id);
  redirect(next);
}

export async function signOut(): Promise<void> {
  await destroyCurrentSession();
  redirect("/sign-in");
}

export async function updateProfile(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const user = await requireUser();
  const name = field(formData, "name").trim();
  if (!name || name.length > 120) {
    return { status: "error", message: null, fieldErrors: { name: "Enter a name of 120 characters or fewer." } };
  }
  await db.update(users).set({ name, updatedAt: new Date() }).where(eq(users.id, user.id));
  revalidatePath("/", "layout");
  return { status: "success", message: "Saved.", fieldErrors: {} };
}

export async function changePassword(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const user = await requireUser();
  const current = field(formData, "currentPassword");
  const next = field(formData, "newPassword");
  const problem = passwordProblem(next);
  if (problem) return { status: "error", message: null, fieldErrors: { newPassword: problem } };

  const [row] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id)).limit(1);
  if (!row || !(await verifyPassword(current, row.passwordHash))) {
    return { status: "error", message: null, fieldErrors: { currentPassword: "Current password is incorrect." } };
  }
  await db.update(users).set({ passwordHash: await hashPassword(next), updatedAt: new Date() }).where(eq(users.id, user.id));
  // Sign out every other device, then start a fresh session here.
  await destroyAllSessions(user.id);
  await createSession(user.id);
  return { status: "success", message: "Password changed. Other devices were signed out.", fieldErrors: {} };
}

export async function createApiKey(_prev: ApiKeyFormState, formData: FormData): Promise<ApiKeyFormState> {
  const user = await requireUser();
  const name = field(formData, "name").trim() || "API key";
  if (name.length > 80) return { status: "error", message: "Use a name of 80 characters or fewer.", key: null };
  const [{ value: active }] = await db
    .select({ value: count() })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt)));
  if (active >= 20) return { status: "error", message: "Revoke an unused key first (limit 20).", key: null };
  const { key, prefix, hash } = newApiKey();
  await db.insert(apiKeys).values({ userId: user.id, name, keyHash: hash, prefix });
  revalidatePath("/settings");
  return { status: "success", message: null, key };
}

export async function revokeApiKey(keyId: string): Promise<void> {
  const user = await requireUser();
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, user.id)));
  revalidatePath("/settings");
}

import { count } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { users } from "@/db/schema";
import { signupMode } from "@/auth/policy";
import { getCurrentUser } from "@/auth/session";
import { envValue, processEnv } from "@/integrations/status";
import { SignUpForm } from "@/ui/auth-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create account · ShippingRiskIntel" };

export default async function SignUpPage() {
  if (await getCurrentUser()) redirect("/");
  const env = processEnv();
  const [{ value: userCount }] = await db.select({ value: count() }).from(users);
  const mode = signupMode({
    userCount,
    inviteCode: envValue(env, "SIGNUP_CODE"),
    openSignup: envValue(env, "ALLOW_OPEN_SIGNUP") === "true",
  });

  if (mode === "closed") {
    return (
      <>
        <h1>Sign-ups are closed</h1>
        <p className="auth-lead">
          This workspace is invite-only. Ask the workspace owner to invite you, then come back here.
        </p>
        <p className="auth-switch">
          Already have an account? <Link href="/sign-in">Sign in</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1>{mode === "first_account" ? "Set up your workspace" : "Create your account"}</h1>
      <p className="auth-lead">
        {mode === "first_account"
          ? "You're the first one here — this account becomes the workspace owner."
          : mode === "invite"
            ? "Join your team's workspace with the invite code they shared."
            : "Create an account to start scoring shipments."}
      </p>
      <SignUpForm needsInviteCode={mode === "invite"} firstAccount={mode === "first_account"} />
    </>
  );
}

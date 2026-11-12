import { asc } from "drizzle-orm";

import { signOut } from "@/app/actions/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/auth/session";
import { envValue, processEnv } from "@/integrations/status";
import { PasswordForm, ProfileForm } from "@/ui/auth-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · ShippingRiskIntel" };

function fmt(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "Never";
}

export default async function SettingsPage() {
  const user = await requireUser();
  const env = processEnv();

  const members =
    user.role === "owner"
      ? await db
          .select({ name: users.name, email: users.email, role: users.role, createdAt: users.createdAt })
          .from(users)
          .orderBy(asc(users.createdAt))
      : [];
  const inviteCodeSet = Boolean(envValue(env, "SIGNUP_CODE"));
  const openSignup = envValue(env, "ALLOW_OPEN_SIGNUP") === "true";

  return (
    <main className="page settings-page">
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="page-subtitle">
            Signed in as {user.email} · {user.role === "owner" ? "Workspace owner" : "Member"}
          </p>
        </div>
        <form action={signOut}>
          <button type="submit" className="button-secondary">
            Sign out
          </button>
        </form>
      </header>

      <section className="settings-section">
        <div className="settings-intro">
          <h2>Profile</h2>
          <p>How your name appears in the workspace.</p>
        </div>
        <div className="settings-body">
          <ProfileForm name={user.name} />
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-intro">
          <h2>Password</h2>
          <p>Changing it signs out every other device.</p>
        </div>
        <div className="settings-body">
          <PasswordForm />
        </div>
      </section>

      {user.role === "owner" && (
        <section className="settings-section">
          <div className="settings-intro">
            <h2>Workspace</h2>
            <p>Everyone in the workspace sees the same shipments.</p>
          </div>
          <div className="settings-body">
            <p className="settings-note">
              {openSignup
                ? "Anyone with the link can create an account."
                : inviteCodeSet
                  ? "Teammates join at /sign-up with your workspace invite code."
                  : "Sign-ups are closed. Only existing members can sign in."}
            </p>
            <table className="api-key-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.email}>
                    <td>{m.name}</td>
                    <td>{m.email}</td>
                    <td>{m.role === "owner" ? "Owner" : "Member"}</td>
                    <td>{fmt(m.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

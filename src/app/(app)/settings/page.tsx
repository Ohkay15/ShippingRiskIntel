import { asc, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";

import { revokeApiKey, signOut } from "@/app/actions/auth";
import { db } from "@/db";
import { apiKeys, users } from "@/db/schema";
import { requireUser } from "@/auth/session";
import { envValue, processEnv } from "@/integrations/status";
import { NewApiKeyForm, PasswordForm, ProfileForm } from "@/ui/auth-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · ShippingRiskIntel" };

function fmt(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "Never";
}

export default async function SettingsPage() {
  const user = await requireUser();
  const env = processEnv();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "your-app"}`;

  const keys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, user.id))
    .orderBy(desc(apiKeys.createdAt));
  const activeKeys = keys.filter((k) => !k.revokedAt);

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

      <section className="settings-section">
        <div className="settings-intro">
          <h2>API keys</h2>
          <p>
            Connect Claude, ChatGPT or any MCP client to <code>{origin}/api/mcp</code>. Keys can read shipments and
            run the assistant&apos;s tools; they cannot change records.
          </p>
        </div>
        <div className="settings-body">
          <NewApiKeyForm mcpUrl={`${origin}/api/mcp`} />
          {keys.length > 0 && (
            <table className="api-key-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className={k.revokedAt ? "api-key-revoked" : undefined}>
                    <td>{k.name}</td>
                    <td>
                      <code>{k.prefix}…</code>
                    </td>
                    <td>{fmt(k.createdAt)}</td>
                    <td>{fmt(k.lastUsedAt)}</td>
                    <td className="api-key-actions">
                      {k.revokedAt ? (
                        <span className="muted-dash">Revoked</span>
                      ) : (
                        <form action={revokeApiKey.bind(null, k.id)}>
                          <button type="submit" className="link-button">
                            Revoke
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="auth-hint">{activeKeys.length} active of 20.</p>
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
                ? "Anyone with the link can create an account (ALLOW_OPEN_SIGNUP=true)."
                : inviteCodeSet
                  ? "Teammates join at /sign-up with the invite code stored in SIGNUP_CODE."
                  : "Sign-ups are closed. To invite teammates, set SIGNUP_CODE in Vercel and share it with them."}
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

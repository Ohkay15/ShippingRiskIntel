import { requireUser } from "@/auth/session";
import { processEnv, statusCounts, STATUS_LABELS, visibleIntegrationReport } from "@/integrations/status";
import { CATEGORY_LABELS, type ConnectorStatus } from "@/integrations/types";

export const dynamic = "force-dynamic";

const ACCESS_LABELS = {
  public: "Free",
  self_serve: "Your own account",
  partner: "Partner agreement",
} as const;

const STATUS_HELP: Record<ConnectorStatus, string> = {
  connected: "Live and in use.",
  add_key: "Ready to connect with your account.",
  keys_set_pending_contract: "Account linked. Finishing setup with the partner.",
  partner_access: "Available through a partner agreement.",
  planned: "Coming soon.",
};

export default async function IntegrationsPage() {
  await requireUser();
  const report = visibleIntegrationReport(processEnv());
  const counts = statusCounts(report);
  const total = report.reduce((n, g) => n + g.connectors.length, 0);

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Integrations</h1>
          <p className="page-subtitle">
            The tools and data sources this workspace can use. Anything not connected yet falls back to built-in
            estimates, so every feature keeps working.
          </p>
        </div>
      </header>

      <section className="integration-stats" aria-label="Summary">
        <div className="stat">
          <span className="stat-value">{counts.connected}</span>
          <span className="stat-label">Connected</span>
        </div>
        <div className="stat">
          <span className="stat-value">{counts.add_key}</span>
          <span className="stat-label">Ready to connect</span>
        </div>
        <div className="stat">
          <span className="stat-value">{counts.partner_access + counts.keys_set_pending_contract}</span>
          <span className="stat-label">Need partner access</span>
        </div>
        <div className="stat">
          <span className="stat-value">{total}</span>
          <span className="stat-label">Available</span>
        </div>
      </section>

      {report.map((group) => (
        <section key={group.category} className="integration-group">
          <h2>{CATEGORY_LABELS[group.category]}</h2>
          <div className="integration-grid">
            {group.connectors.map(({ def, status }) => (
              <article key={def.id} className={`integration-card integration-${status}`}>
                <header>
                  <h3>{def.name}</h3>
                  <span className={`integration-status status-pill-${status}`}>{STATUS_LABELS[status]}</span>
                </header>
                <p className="integration-summary">{def.summary}</p>
                <dl className="integration-meta">
                  <div>
                    <dt>Powers</dt>
                    <dd>{def.powers}</dd>
                  </div>
                  <div>
                    <dt>Access</dt>
                    <dd>{ACCESS_LABELS[def.access]}</dd>
                  </div>
                </dl>
                <p className="integration-help">
                  {STATUS_HELP[status]}
                  {def.docsUrl && (
                    <>
                      {" "}
                      <a href={def.docsUrl} target="_blank" rel="noreferrer">
                        Docs
                      </a>
                    </>
                  )}
                </p>
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

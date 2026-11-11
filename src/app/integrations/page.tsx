import {
  integrationStatusReport,
  processEnv,
  statusCounts,
  STATUS_LABELS,
} from "@/integrations/status";
import { CATEGORY_LABELS, type ConnectorStatus } from "@/integrations/types";

export const dynamic = "force-dynamic";

const ACCESS_LABELS = {
  public: "Free public key",
  self_serve: "Self-serve key",
  partner: "Partner agreement",
} as const;

const STATUS_HELP: Record<ConnectorStatus, string> = {
  connected: "Live — calls go to the real service.",
  add_key: "Built. Add the variables above in Vercel and redeploy.",
  keys_set_pending_contract: "Keys found. Request mapping is finished once the partner shares its API spec.",
  partner_access: "Adapter slot is built. Needs a partner agreement for keys and API docs.",
  planned: "Catalogued; adapter not built yet.",
};

export default function IntegrationsPage() {
  const report = integrationStatusReport(processEnv());
  const counts = statusCounts(report);
  const total = report.reduce((n, g) => n + g.connectors.length, 0);

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Integrations</h1>
          <p className="page-subtitle">
            Every connector is wired through one framework. A connector goes live when its keys are added to the
            environment; until then the app runs on built-in sample data, so nothing breaks.
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
          <span className="stat-label">Ready for a key</span>
        </div>
        <div className="stat">
          <span className="stat-value">{counts.partner_access + counts.keys_set_pending_contract}</span>
          <span className="stat-label">Need partner access</span>
        </div>
        <div className="stat">
          <span className="stat-value">{total}</span>
          <span className="stat-label">In the catalog</span>
        </div>
      </section>

      <div className="integration-howto">
        <h2>How to switch one on</h2>
        <ol>
          <li>
            In Vercel, open <strong>Settings → Environment Variables</strong>.
          </li>
          <li>Add the variables listed on the connector card, for all environments.</li>
          <li>
            Redeploy. The card turns <strong>Connected</strong>.
          </li>
        </ol>
      </div>

      {report.map((group) => (
        <section key={group.category} className="integration-group">
          <h2>{CATEGORY_LABELS[group.category]}</h2>
          <div className="integration-grid">
            {group.connectors.map(({ def, status, missingEnv }) => (
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
                <div className="integration-env">
                  {def.requiredEnv.map((name) => (
                    <code key={name} className={missingEnv.includes(name) ? "env-missing" : "env-set"}>
                      {name}
                    </code>
                  ))}
                  {def.optionalEnv?.map((name) => (
                    <code key={name} className="env-optional" title="Optional">
                      {name}
                    </code>
                  ))}
                </div>
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

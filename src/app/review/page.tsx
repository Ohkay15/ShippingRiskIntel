import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { shipments } from "@/db/schema";
import type { ShipmentStatus } from "@/db/lifecycle";
import { StatusBadge } from "@/ui/status-badge";

export const dynamic = "force-dynamic";

/**
 * The MVP's "rule by exception" surface: every record parked in Needs
 * review by the confidence gate. Resolving a record's fields (via the
 * intake form) and re-confirming re-scores nothing by itself — scoring is
 * a later feature — but it moves the record out of this queue.
 */
export default async function ReviewQueuePage() {
  let rows: {
    id: string;
    status: ShipmentStatus;
    flaggedFields: { path: string }[] | null;
    updatedAt: Date;
  }[];
  try {
    rows = await db
      .select({
        id: shipments.id,
        status: shipments.status,
        flaggedFields: shipments.flaggedFields,
        updatedAt: shipments.updatedAt,
      })
      .from(shipments)
      .where(eq(shipments.status, "needs_review"))
      .orderBy(desc(shipments.updatedAt))
      .limit(100);
  } catch {
    return (
      <main className="page">
        <div className="state-panel state-error">
          <h1>Database unavailable</h1>
          <p>
            The review queue could not be loaded because the database is not
            reachable. Start Postgres with <code>docker compose up -d</code>{" "}
            and retry.
          </p>
          <Link href="/" className="button-secondary">
            ← All shipments
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Review queue</h1>
          <p className="page-subtitle">
            Records with fields the confidence gate stopped. Every field here
            shows the provider&rsquo;s verbatim evidence on its record page.
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="state-panel">
          <h2>Nothing needs review</h2>
          <p>
            No records are waiting for human judgment. Records land here when
            extraction confidence falls below 0.75 or required data is
            missing.
          </p>
          <Link href="/" className="button-secondary">
            ← All shipments
          </Link>
        </div>
      ) : (
        <ul className="shipment-list">
          {rows.map((row) => (
            <li key={row.id} className="shipment-row">
              <Link href={`/shipments/${row.id}`} className="shipment-link">
                <span className="mono">{row.id}</span>
                <StatusBadge status={row.status} />
                <span>
                  {row.flaggedFields?.length ?? 0} flagged field(s)
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="page-footer">
        <Link href="/">← All shipments</Link>
      </p>
    </main>
  );
}

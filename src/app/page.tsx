import Link from "next/link";
import { desc } from "drizzle-orm";

import { db } from "@/db";
import { shipments } from "@/db/schema";
import type { ShipmentStatus } from "@/db/lifecycle";
import { StatusBadge } from "@/ui/status-badge";

export const dynamic = "force-dynamic";

export default async function Home() {
  let rows: { id: string; status: ShipmentStatus; createdAt: Date }[];
  try {
    rows = await db
      .select({ id: shipments.id, status: shipments.status, createdAt: shipments.createdAt })
      .from(shipments)
      .orderBy(desc(shipments.createdAt))
      .limit(100);
  } catch {
    return <DatabaseUnavailable />;
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>ShippingRiskIntel</h1>
          <p className="page-subtitle">
            Score every shipment, explain it, and surface the coverage gap.
          </p>
        </div>
        <Link href="/shipments/new" className="button-primary">
          + New shipment
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="state-panel">
          <h2>No shipment records yet</h2>
          <p>
            Create the first record by entering the ten risk factors, or start
            from a document upload on the record once created.
          </p>
          <Link href="/shipments/new" className="button-primary">
            Create the first shipment record
          </Link>
        </div>
      ) : (
        <table className="shipments-table">
          <thead>
            <tr>
              <th>Record</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/shipments/${row.id}`} className="mono">
                    {row.id}
                  </Link>
                </td>
                <td>
                  <StatusBadge status={row.status} />
                </td>
                <td>{row.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

function DatabaseUnavailable() {
  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>ShippingRiskIntel</h1>
          <p className="page-subtitle">
            Score every shipment, explain it, and surface the coverage gap.
          </p>
        </div>
        <Link href="/shipments/new" className="button-primary">
          + New shipment
        </Link>
      </header>
      <div className="state-panel state-error">
        <h2>Database unavailable</h2>
        <p>
          The shipment list could not be loaded because the database is not
          reachable. Start Postgres with <code>docker compose up -d</code> and
          retry.
        </p>
      </div>
    </main>
  );
}

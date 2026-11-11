import Link from "next/link";
import { desc } from "drizzle-orm";

import { db } from "@/db";
import { shipments } from "@/db/schema";
import type { ShipmentStatus } from "@/db/lifecycle";
import {
  coverageGapCell,
  coverageGapView,
  type CoverageGapView,
} from "@/coverage/display";
import {
  parseSortParams,
  sortShipmentRows,
  type ShipmentListRow,
  type ShipmentSortKey,
  type SortDirection,
} from "@/dashboard/list-rows";
import type { ShipmentIntake } from "@/schemas/shipment";
import { effectiveCoverageUsd } from "@/schemas/shipment";
import type { RiskProfile } from "@/scoring/engine";
import { DemoDatasetButton } from "@/ui/demo-dataset-button";
import { MatrixCellBadge, ScoreBadge } from "@/ui/risk-badges";
import { StatusBadge } from "@/ui/status-badge";
import { displayShipmentId } from "@/dashboard/record-id";

export const dynamic = "force-dynamic";

interface ListRow extends ShipmentListRow {
  cargoDescription: string | null;
  lane: string | null;
  gapView: CoverageGapView | null;
  provisional: boolean;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const sort = parseSortParams(firstParam(params.sort), firstParam(params.dir));

  let raw: {
    id: string;
    status: ShipmentStatus;
    intakeData: ShipmentIntake;
    profile: RiskProfile | null;
    updatedAt: Date;
  }[];
  try {
    raw = await db
      .select({
        id: shipments.id,
        status: shipments.status,
        intakeData: shipments.intakeData,
        profile: shipments.profile,
        updatedAt: shipments.updatedAt,
      })
      .from(shipments)
      .orderBy(desc(shipments.updatedAt))
      .limit(100);
  } catch {
    return <DatabaseUnavailable />;
  }

  const rows: ListRow[] = raw.map((row) => {
    // Profiles render for scored records — and as provisional (grayed) for
    // records parked in needs_review. Drafts/extracting have none.
    const profile =
      row.profile != null && (row.status === "scored" || row.status === "needs_review")
        ? row.profile
        : null;
    return {
      id: row.id,
      status: row.status,
      profile,
      updatedAt: row.updatedAt,
      cargoDescription: row.intakeData.cargo_hazard.cargoDescription ?? null,
      lane: row.intakeData.route_lane.laneId ?? null,
      gapView: profile
        ? coverageGapView(
            profile.coverageGapUsd,
            row.intakeData.value_fragility.declaredValueUsd ?? null,
            effectiveCoverageUsd(row.intakeData.coverage)
          )
        : null,
      provisional: row.status === "needs_review",
    };
  });

  const sorted = sortShipmentRows(rows, sort.key, sort.direction) as ListRow[];

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Shipments</h1>
          <p className="page-subtitle">
            Every record with its score, matrix position, and the dollar gap
            between declared value and coverage. The riskiest exposure leads.
          </p>
        </div>
        <div className="header-actions">
          <Link href="/assistant" className="button-secondary">
            Ask the assistant
          </Link>
          <Link href="/shipments/new" className="button-primary">
            New shipment
          </Link>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="state-panel">
          <h2>No shipment records yet</h2>
          <p>
            Create the first record by entering the ten risk factors, or load
            the synthetic demo dataset to see the dashboard populated.
          </p>
          <DemoDatasetButton />
          <p className="field-hint">
            Or start from scratch:{" "}
            <Link href="/shipments/new">create a record manually</Link>.
          </p>
        </div>
      ) : (
        <table className="shipments-table">
          <thead>
            <tr>
              <th>Record</th>
              <th>Status</th>
              <th>
                <SortLink label="Score" sortKey="score" current={sort} />
              </th>
              <th>Matrix</th>
              <th>
                <SortLink label="Coverage gap" sortKey="gap" current={sort} />
              </th>
              <th>
                <SortLink label="Updated" sortKey="updated" current={sort} />
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/shipments/${row.id}`} className="record-id" title={row.id}>
                    {displayShipmentId(row.id)}
                  </Link>
                  {row.cargoDescription && (
                    <span className="record-desc">
                      {row.cargoDescription}
                      {row.lane ? ` · ${row.lane}` : ""}
                    </span>
                  )}
                </td>
                <td>
                  <StatusBadge status={row.status} />
                </td>
                <td>
                  {row.profile ? (
                    <ScoreBadge profile={row.profile} provisional={row.provisional} />
                  ) : (
                    <span className="muted-dash" title="Not scored yet">
                      —
                    </span>
                  )}
                </td>
                <td>
                  {row.profile ? (
                    <MatrixCellBadge cell={row.profile.cell} />
                  ) : (
                    <span className="muted-dash">—</span>
                  )}
                </td>
                <td className={row.gapView ? `gap-cell gap-${row.gapView.tone}` : ""}>
                  {row.gapView ? (
                    <span
                      className={row.provisional ? "provisional" : undefined}
                      title={row.gapView.detail}
                    >
                      {coverageGapCell(row.gapView)}
                    </span>
                  ) : (
                    <span className="muted-dash" title="No profile yet">
                      —
                    </span>
                  )}
                </td>
                <td className="nowrap">
                  {row.updatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

function SortLink({
  label,
  sortKey,
  current,
}: {
  label: string;
  sortKey: ShipmentSortKey;
  current: { key: ShipmentSortKey; direction: SortDirection };
}) {
  const nextDir =
    current.key === sortKey && current.direction === "desc" ? "asc" : "desc";
  const arrow =
    current.key === sortKey ? (current.direction === "asc" ? " ▲" : " ▼") : "";
  return (
    <Link href={`/?sort=${sortKey}&dir=${nextDir}`} className="sort-link">
      {label}
      {arrow}
    </Link>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function DatabaseUnavailable() {
  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Shipments</h1>
          <p className="page-subtitle">
            Score every shipment, explain it, and surface the coverage gap.
          </p>
        </div>
      </header>
      <div className="state-panel state-error">
        <h2>Database unavailable</h2>
        <p>
          The shipment list could not be loaded because the database is not
          reachable. Check that <code>DATABASE_URL</code> is set (locally:
          start Postgres with <code>docker compose up -d</code>) and retry.
        </p>
      </div>
    </main>
  );
}

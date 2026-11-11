import { requireUser } from "@/auth/session";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { resolveReviewRecord } from "@/app/actions/review";
import { db } from "@/db";
import { shipments } from "@/db/schema";
import type { ShipmentStatus } from "@/db/lifecycle";
import type { FlaggedField } from "@/extraction/gate";
import { FACTOR_GROUP_META } from "@/intake/form-fields";
import { FACTOR_KEYS, shipmentIntakeSchema, type FactorKey } from "@/schemas/shipment";
import { recordSummary } from "@/profile/view-model";
import { StatusBadge } from "@/ui/status-badge";
import { displayShipmentId } from "@/dashboard/record-id";
import { ReviewResolveForm } from "./review-resolve-form";

export const dynamic = "force-dynamic";

/**
 * The MVP's "rule by exception" surface: every record parked in Needs
 * review by the confidence gate. Each entry carries its own resolution
 * form — flagged fields editable in place with the provider's evidence,
 * or confirmed at the conservative default — and resolving re-scores the
 * record immediately.
 */
export default async function ReviewQueuePage() {
  await requireUser();
  let rows: {
    id: string;
    status: ShipmentStatus;
    intakeData: unknown;
    profile: unknown;
    flaggedFields: FlaggedField[] | null;
    updatedAt: Date;
  }[];
  try {
    rows = await db
      .select({
        id: shipments.id,
        status: shipments.status,
        intakeData: shipments.intakeData,
        profile: shipments.profile,
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
            Records with fields the confidence gate stopped. Edit the flagged
            values in place — or confirm a factor at its conservative default
            — and the record re-scores the moment you save.
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="state-panel">
          <h2>Nothing needs review</h2>
          <p>
            No records are waiting for human judgment. Records land here when
            extraction confidence falls below 0.75, required data is missing,
            or a score relied on unconfirmed defaults.
          </p>
          <Link href="/" className="button-secondary">
            ← All shipments
          </Link>
        </div>
      ) : (
        <ul className="review-queue">
          {rows.map((row) => (
            <ReviewQueueEntry key={row.id} row={row} />
          ))}
        </ul>
      )}

      <p className="page-footer">
        <Link href="/">← All shipments</Link>
      </p>
    </main>
  );
}

function ReviewQueueEntry({
  row,
}: {
  row: {
    id: string;
    status: ShipmentStatus;
    intakeData: unknown;
    profile: unknown;
    flaggedFields: FlaggedField[] | null;
    updatedAt: Date;
  };
}) {
  const flagged = row.flaggedFields ?? [];
  // Stored intake is re-validated at the boundary; an unreadable record
  // still shows in the queue, linked to its record page for a full edit.
  const intake = shipmentIntakeSchema.safeParse(row.intakeData);

  return (
    <li className="review-entry">
      <header className="review-entry-header">
        <Link href={`/shipments/${row.id}`} className="shipment-link" title={row.id}>
          {displayShipmentId(row.id)}
        </Link>
        <StatusBadge status={row.status} />
        <span className="flag-count">
          {flagged.length > 0
            ? `${flagged.length} flagged field${flagged.length === 1 ? "" : "s"}`
            : "scored on defaults — confirm factors"}
        </span>
        <span className="entry-updated mono">
          {row.updatedAt.toISOString().slice(0, 16).replace("T", " ")}
        </span>
      </header>

      {intake.success && (
        <p className="entry-summary">{recordSummary(intake.data)}</p>
      )}

      {intake.success ? (
        <details>
          <summary className="button-secondary">
            {flagged.length > 0 ? "Resolve fields" : "Confirm factors"}
          </summary>
          <ReviewResolveForm
            action={resolveReviewRecord.bind(null, row.id)}
            flaggedFields={flagged}
            defaults={wireDefaults(intake.data, flagged)}
            affectedFactors={affectedFactors(flagged, defaultFactors(row.profile))}
          />
        </details>
      ) : (
        <p className="field-hint">
          The stored record failed validation — resolve it from the{" "}
          <Link href={`/shipments/${row.id}/edit`}>full edit form</Link>.
        </p>
      )}
    </li>
  );
}

/** Current values keyed by wire path, serialized for the form inputs. */
function wireDefaults(
  intake: unknown,
  flagged: FlaggedField[]
): Record<string, string | string[]> {
  const defaults: Record<string, string | string[]> = {};
  const groups = intake as Record<string, Record<string, unknown>>;
  for (const flag of flagged) {
    const [group, leaf] = flag.path.split(".");
    const value = groups[group]?.[leaf];
    if (value == null) {
      defaults[flag.path] = "";
    } else if (Array.isArray(value)) {
      defaults[flag.path] = value.map(String);
    } else {
      defaults[flag.path] = String(value);
    }
  }
  return defaults;
}

/** Factors whose score used the conservative default — from the stored profile. */
function defaultFactors(profile: unknown): FactorKey[] {
  const parsed = z
    .object({
      ratings: z.array(
        z.object({
          factor: z.string(),
          basis: z.object({ source: z.string() }).passthrough(),
        })
      ),
    })
    .safeParse(profile);
  if (!parsed.success) return [];
  return parsed.data.ratings
    .filter((r) => r.basis.source === "default")
    .map((r) => r.factor)
    .filter((factor): factor is FactorKey =>
      (FACTOR_KEYS as readonly string[]).includes(factor)
    );
}

/** Unique factors the flags or defaults touch, for the checkboxes. */
function affectedFactors(
  flagged: FlaggedField[],
  extra: FactorKey[] = []
): { key: FactorKey; title: string }[] {
  const seen = new Map<FactorKey, string>();
  const groupOf = (key: string) =>
    FACTOR_GROUP_META.find((entry) => entry.key === key);
  for (const flag of flagged) {
    const meta = groupOf(flag.path.split(".")[0]);
    if (meta) seen.set(meta.key, meta.title);
  }
  for (const factor of extra) {
    const meta = groupOf(factor);
    if (meta) seen.set(meta.key, meta.title);
  }
  return [...seen].map(([key, title]) => ({ key, title }));
}

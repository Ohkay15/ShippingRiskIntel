import { requireUser } from "@/auth/session";
import Link from "next/link";
import { eq } from "drizzle-orm";

import { updateRecord } from "@/app/actions/update";
import { db } from "@/db";
import { shipments } from "@/db/schema";
import type { ShipmentStatus } from "@/db/lifecycle";
import { IntakeForm } from "@/intake/intake-form";
import { shipmentIntakeSchema, type ShipmentIntake } from "@/schemas/shipment";

export const dynamic = "force-dynamic";

/**
 * Edit a shipment record: the full ten-factor form pre-filled from the
 * stored record. Saving re-scores immediately (Draft → score/needs_review
 * via the gateway) — that is the edit → re-score loop.
 */
export default async function EditShipmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  let status: ShipmentStatus | undefined;
  let intake: ShipmentIntake | undefined;
  try {
    const rows = await db
      .select({
        status: shipments.status,
        intakeData: shipments.intakeData,
      })
      .from(shipments)
      .where(eq(shipments.id, id))
      .limit(1);
    const row = rows[0];
    const parsed = row
      ? shipmentIntakeSchema.safeParse(row.intakeData)
      : undefined;
    if (row && parsed?.success) {
      status = row.status;
      intake = parsed.data;
    }
  } catch {
    return <Panel title="Database unavailable">
      <p>
        The record could not be loaded because the database is not reachable.
        Start Postgres with <code>docker compose up -d</code> and retry.
      </p>
      <Link href="/" className="button-secondary">← All shipments</Link>
    </Panel>;
  }

  if (!intake) {
    return (
      <Panel title="Record not found">
        <p>No readable shipment record exists with id {id}.</p>
        <Link href="/" className="button-secondary">← All shipments</Link>
      </Panel>
    );
  }

  const locked = status === "actioned";
  const extracting = status === "extracting";

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Edit shipment record</h1>
          <p className="mono">{id}</p>
          <p className="page-subtitle">
            Saving re-scores the record immediately. Clearing a field makes it
            unknown — it takes the conservative default and flags review
            rather than guessing.
          </p>
        </div>
        <Link href={`/shipments/${id}`} className="button-secondary">
          Cancel
        </Link>
      </header>

      {locked ? (
        <Panel title="Record locked">
          <p>
            This record is actioned (carrier selected) and cannot be edited.
            Reopen it first.
          </p>
          <Link href={`/shipments/${id}`} className="button-secondary">
            ← Back to the record
          </Link>
        </Panel>
      ) : extracting ? (
        <Panel title="Extraction in progress">
          <p>
            Extraction is running on this record&rsquo;s documents. Wait for
            it to finish or cancel it on the record page before editing.
          </p>
          <Link href={`/shipments/${id}`} className="button-secondary">
            ← Back to the record
          </Link>
        </Panel>
      ) : (
        <IntakeForm
          action={updateRecord.bind(null, id)}
          defaults={intake}
          submitLabel="Save and re-score"
        />
      )}
    </main>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="page">
      <div className="state-panel">
        <h2>{title}</h2>
        {children}
      </div>
    </main>
  );
}

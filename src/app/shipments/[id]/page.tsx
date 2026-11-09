import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { uploadDocument } from "@/app/actions/documents";
import { db } from "@/db";
import { shipments, shipmentDocuments } from "@/db/schema";
import type { ShipmentStatus } from "@/db/lifecycle";
import {
  DOCUMENT_KIND_LABELS,
  type DocumentKind,
} from "@/documents/kinds";
import { DocumentUploadPanel } from "@/documents/document-upload-panel";
import { shipmentIntakeSchema, type ShipmentIntake } from "@/schemas/shipment";
import { StatusBadge } from "@/ui/status-badge";
import { IntakeSummary } from "./intake-summary";

export const dynamic = "force-dynamic";

export default async function ShipmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let record:
    | { id: string; status: ShipmentStatus; intakeData: ShipmentIntake }
    | undefined;
  let documents: {
    id: string;
    kind: DocumentKind;
    filename: string;
    createdAt: Date;
  }[] = [];

  try {
    const rows = await db
      .select({
        id: shipments.id,
        status: shipments.status,
        intakeData: shipments.intakeData,
      })
      .from(shipments)
      .where(eq(shipments.id, id))
      .limit(1);
    const row = rows[0];
    // Re-validate at the boundary: stored JSON is trusted only after it
    // parses against the shared contract.
    const intake = row
      ? shipmentIntakeSchema.safeParse(row.intakeData)
      : undefined;
    if (row && intake?.success) {
      record = { id: row.id, status: row.status, intakeData: intake.data };
      documents = await db
        .select({
          id: shipmentDocuments.id,
          kind: shipmentDocuments.kind,
          filename: shipmentDocuments.filename,
          createdAt: shipmentDocuments.createdAt,
        })
        .from(shipmentDocuments)
        .where(eq(shipmentDocuments.shipmentId, id))
        .orderBy(desc(shipmentDocuments.createdAt));
    } else {
      record = undefined;
    }
  } catch {
    return <DatabaseUnavailable />;
  }

  if (!record) {
    return <RecordNotFound id={id} />;
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Shipment record</h1>
          <p className="mono">{record.id}</p>
        </div>
        <StatusBadge status={record.status} />
      </header>

      <DocumentUploadPanel
        shipmentId={record.id}
        action={uploadDocument.bind(null, record.id)}
      />

      {documents.length === 0 ? (
        <section className="document-panel">
          <h2>Attached documents</h2>
          <p className="field-hint">
            No documents attached yet. Upload a commercial invoice, packing
            list, bill of lading, or DG declaration above to pre-fill this
            record from its contents.
          </p>
        </section>
      ) : (
        <section className="document-panel">
          <h2>Attached documents</h2>
          <ul className="document-list">
            {documents.map((doc) => (
              <li key={doc.id} className="document-row">
                <span>{DOCUMENT_KIND_LABELS[doc.kind]}</span>
                <span className="mono">{doc.filename}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <IntakeSummary intake={record.intakeData} />

      <p className="page-footer">
        <Link href="/">← All shipments</Link>
      </p>
    </main>
  );
}

function DatabaseUnavailable() {
  return (
    <main className="page">
      <div className="state-panel state-error">
        <h1>Database unavailable</h1>
        <p>
          The record could not be loaded because the database is not
          reachable. Start Postgres with <code>docker compose up -d</code> and
          retry.
        </p>
        <Link href="/" className="button-secondary">
          ← All shipments
        </Link>
      </div>
    </main>
  );
}

function RecordNotFound({ id }: { id: string }) {
  return (
    <main className="page">
      <div className="state-panel">
        <h1>Record not found</h1>
        <p>No readable shipment record exists with id {id}.</p>
        <Link href="/" className="button-secondary">
          ← All shipments
        </Link>
      </div>
    </main>
  );
}

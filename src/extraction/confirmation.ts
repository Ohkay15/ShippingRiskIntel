import { eq } from "drizzle-orm";

import { db } from "@/db";
import { shipmentDocuments, shipments } from "@/db/schema";
import {
  applyConfidenceGate,
  mergeExtractions,
  mergeIntake,
} from "@/extraction/gate";
import { canConfirmRecord } from "@/lifecycle/machine";
import { getLlmClient } from "@/llm";
import { shipmentIntakeSchema } from "@/schemas/shipment";

export type ConfirmationOutcome =
  | { ok: true; providerName: string; flaggedCount: number }
  | { ok: false; message: string };

/**
 * The human gate between upload and any scoring, as a headless-callable
 * service: an operator confirms a draft record, extraction runs, the
 * confidence gate routes the result. This NEVER scores — writing a
 * Scored/Actioned status is owned by later stages.
 *
 * The server action (app/actions/extraction.ts) is a thin wrapper that adds
 * request concerns only (form parsing, revalidation, state mapping); the
 * full-flow script calls this directly so it exercises the real pipeline,
 * not a re-implementation of it.
 */
export async function confirmAndExtract(
  id: string
): Promise<ConfirmationOutcome> {
  const rows = await db
    .select()
    .from(shipments)
    .where(eq(shipments.id, id))
    .limit(1);
  const record = rows[0];
  if (!record) {
    return { ok: false, message: "Record not found." };
  }
  if (!canConfirmRecord(record.status)) {
    return {
      ok: false,
      message: `Record is ${record.status}; only draft records can be confirmed for extraction.`,
    };
  }

  const documents = await db
    .select({ kind: shipmentDocuments.kind, rawText: shipmentDocuments.rawText })
    .from(shipmentDocuments)
    .where(eq(shipmentDocuments.shipmentId, id));
  if (documents.length === 0) {
    return {
      ok: false,
      message: "Upload at least one document before confirming.",
    };
  }

  // Extracting is a visible state: set it before the (possibly slow) LLM
  // round-trips so the operator sees progress, not a dead button.
  await db
    .update(shipments)
    .set({ status: "extracting", updatedAt: new Date() })
    .where(eq(shipments.id, id));

  try {
    const client = getLlmClient();
    const results = [];
    for (const doc of documents) {
      results.push(await client.extractShipment({ kind: doc.kind, text: doc.rawText }));
    }
    const merged = mergeExtractions(results);
    if (!merged) {
      throw new Error("no extraction results were produced");
    }
    const gated = applyConfidenceGate(merged);

    // Validated at the boundary even though the gate already used the
    // schema — stored JSON is trusted only after it parses.
    const intake = mergeIntake(record.intakeData, gated.intake);
    const intakeCheck = shipmentIntakeSchema.safeParse(intake);
    if (!intakeCheck.success) {
      throw new Error("merged intake failed schema validation");
    }

    await db
      .update(shipments)
      .set({
        status: "needs_review",
        intakeData: intakeCheck.data,
        flaggedFields: gated.flaggedFields,
        updatedAt: new Date(),
      })
      .where(eq(shipments.id, id));

    return {
      ok: true,
      providerName: client.name,
      flaggedCount: gated.flaggedFields.length,
    };
  } catch (error) {
    // Extraction failed — nothing was scored, so the record returns to
    // Draft where the operator can retry. The error is surfaced to the
    // caller, never swallowed.
    await db
      .update(shipments)
      .set({ status: "draft", updatedAt: new Date() })
      .where(eq(shipments.id, id));
    return {
      ok: false,
      message: `Extraction failed: ${error instanceof Error ? error.message : "unknown error"}. The record was returned to Draft; nothing was scored.`,
    };
  }
}

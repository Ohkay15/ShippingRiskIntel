"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  applyConfidenceGate,
  mergeExtractions,
  mergeIntake,
} from "@/extraction/gate";
import { db } from "@/db";
import { shipments, shipmentDocuments } from "@/db/schema";
import { getLlmClient } from "@/llm";
import { canConfirmRecord } from "@/lifecycle/machine";
import { shipmentIntakeSchema } from "@/schemas/shipment";

/**
 * The human gate between upload and any scoring: an operator confirms a
 * draft record, extraction runs, the confidence gate routes the result.
 * This action NEVER scores — writing a Scored/Actioned status is owned by
 * later features.
 */

export interface ConfirmState {
  status: "idle" | "error" | "done";
  message?: string;
}

const confirmInput = z.string().uuid();

export async function confirmShipment(
  _prev: ConfirmState,
  formData: FormData
): Promise<ConfirmState> {
  const parsedId = confirmInput.safeParse(formData.get("shipmentId"));
  if (!parsedId.success) {
    return { status: "error", message: "Missing or invalid shipment id." };
  }
  const id = parsedId.data;

  const rows = await db
    .select()
    .from(shipments)
    .where(eq(shipments.id, id))
    .limit(1);
  const record = rows[0];
  if (!record) {
    return { status: "error", message: "Record not found." };
  }
  if (!canConfirmRecord(record.status)) {
    return {
      status: "error",
      message: `Record is ${record.status}; only draft records can be confirmed for extraction.`,
    };
  }

  const documents = await db
    .select({ kind: shipmentDocuments.kind, rawText: shipmentDocuments.rawText })
    .from(shipmentDocuments)
    .where(eq(shipmentDocuments.shipmentId, id));
  if (documents.length === 0) {
    return {
      status: "error",
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

    revalidatePath(`/shipments/${id}`);
    revalidatePath("/review");
    return {
      status: "done",
      message: `Extraction complete (provider: ${client.name}). ${gated.flaggedFields.length} field(s) need review below; the rest pre-filled automatically.`,
    };
  } catch (error) {
    // Extraction failed — nothing was scored, so the record returns to
    // Draft where the operator can retry. The error is surfaced in the
    // action state, never swallowed.
    await db
      .update(shipments)
      .set({ status: "draft", updatedAt: new Date() })
      .where(eq(shipments.id, id));
    revalidatePath(`/shipments/${id}`);
    return {
      status: "error",
      message: `Extraction failed: ${error instanceof Error ? error.message : "unknown error"}. The record was returned to Draft; nothing was scored.`,
    };
  }
}

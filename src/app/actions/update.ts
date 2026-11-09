"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { shipments } from "@/db/schema";
import { scoreShipmentRecord } from "@/scoring/service";
import { applyRecordEdit } from "@/profile/record-edit";
import type { IntakeFormState } from "@/intake/form-state";
import { confirmedFactorsToSchema } from "@/profile/confirmed-factors";
import {
  FACTOR_KEYS,
  shipmentIntakeSchema,
  type FactorKey,
} from "@/schemas/shipment";

/** First wire-path segment → the factor key the flag belongs to. */
function factorOfPath(path: string): FactorKey | null {
  const group = path.split(".")[0];
  return (FACTOR_KEYS as readonly string[]).includes(group)
    ? (group as FactorKey)
    : null;
}

/**
 * Record edit + review-confirm actions. Both end with an immediate re-score
 * through the scoring gateway — resolving a record and seeing the fresh
 * profile is ONE step, not two.
 *
 * Lifecycle rules enforced here (spec §lifecycle):
 * - editing a scored/review record demotes it to Draft before re-scoring;
 * - Actioned records are locked;
 * - "extracting" is not editable (extraction in flight);
 * - nothing scores on operator-blind data — confirm marks human review.
 */

const ERROR_STATE = (message: string): IntakeFormState => ({
  status: "error",
  message,
  fieldErrors: {},
});

export async function updateRecord(
  id: string,
  _prev: IntakeFormState,
  formData: FormData
): Promise<IntakeFormState> {
  const [record] = await db
    .select({
      status: shipments.status,
      intakeData: shipments.intakeData,
    })
    .from(shipments)
    .where(eq(shipments.id, id))
    .limit(1);

  if (!record) {
    return ERROR_STATE("Record not found. It may have been deleted.");
  }
  if (record.status === "actioned") {
    return ERROR_STATE(
      "This record is actioned (carrier selected) and locked. Reopen it before editing."
    );
  }
  if (record.status === "extracting") {
    return ERROR_STATE(
      "Extraction is in progress for this record. Wait for it to finish or cancel it first."
    );
  }

  const outcome = applyRecordEdit(record.intakeData, formData);
  if (!outcome.ok) {
    return { status: "error", message: outcome.message, fieldErrors: outcome.fieldErrors };
  }

  if (outcome.changed) {
    // Edit → demote to Draft, drop the now-stale profile, then re-score.
    await db
      .update(shipments)
      .set({
        intakeData: outcome.intake,
        status: "draft",
        profile: null,
        scoredAt: null,
        updatedAt: new Date(),
      })
      .where(eq(shipments.id, id));
  }

  await scoreShipmentRecord(id);
  revalidatePath("/review");
  redirect(`/shipments/${id}`);
}

/**
 * Confirm-and-score for a draft record with NO documents (manual entry).
 * Documents-bearing drafts confirm through the extraction panel instead —
 * extraction runs first, never an auto-score. This action validates the
 * stored intake and hands the record to the scoring gateway in one step.
 */
export async function confirmAndScore(
  id: string,
  _prev: IntakeFormState,
  _formData: FormData
): Promise<IntakeFormState> {
  const [record] = await db
    .select({ status: shipments.status, intakeData: shipments.intakeData })
    .from(shipments)
    .where(eq(shipments.id, id))
    .limit(1);

  if (!record) {
    return ERROR_STATE("Record not found. It may have been deleted.");
  }
  if (record.status !== "draft") {
    return ERROR_STATE(
      `Record is ${record.status}; only draft records can be confirmed for scoring.`
    );
  }
  if (!shipmentIntakeSchema.safeParse(record.intakeData).success) {
    return ERROR_STATE(
      "The stored record failed validation. Edit and re-save it before scoring."
    );
  }

  await scoreShipmentRecord(id);
  revalidatePath("/review");
  redirect(`/shipments/${id}`);
}

/**
 * Confirm flagged fields at their conservative defaults (review queue's
 * "accept" path). The confirmed factors get a review basis on the next
 * score; if that clears every default-based factor the record scores.
 */
export async function confirmRecordChanges(id: string): Promise<void> {
  const [record] = await db
    .select({
      status: shipments.status,
      confirmedFactors: shipments.confirmedFactors,
      flaggedFields: shipments.flaggedFields,
    })
    .from(shipments)
    .where(eq(shipments.id, id))
    .limit(1);

  if (!record || record.status === "actioned" || record.status === "extracting") {
    return;
  }

  const flaggedFactors = ((record.flaggedFields as
    | { path: string }[]
    | null) ?? [])
    .map((flag) => factorOfPath(flag.path))
    .filter((factor): factor is FactorKey => factor != null);

  const merged = confirmedFactorsToSchema(
    record.confirmedFactors as string[],
    flaggedFactors
  );

  await db
    .update(shipments)
    .set({ confirmedFactors: merged, updatedAt: new Date() })
    .where(eq(shipments.id, id));

  await scoreShipmentRecord(id);
  revalidatePath("/review");
  revalidatePath(`/shipments/${id}`);
}

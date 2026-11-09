import { eq } from "drizzle-orm";

import { db } from "@/db";
import { shipments } from "@/db/schema";
import { fieldErrorsFromZod } from "@/intake/form-errors";
import { canResolveReview } from "@/lifecycle/machine";
import { confirmedFactorsToSchema } from "@/profile/confirmed-factors";
import { mergeIntakeOverlay } from "@/profile/record-edit";
import {
  shipmentIntakeSchema,
  type FactorKey,
} from "@/schemas/shipment";
import { scoreShipmentRecord } from "@/scoring/service";

export type ResolutionOutcome =
  | { ok: true }
  | { ok: false; message: string; fieldErrors: Record<string, string> };

/**
 * Resolve a record's flagged fields from the review queue, as a
 * headless-callable service. The caller posts an overlay (only the fields
 * the operator changed; everything else keeps its stored value) and the
 * factors accepted at their conservative default. Saving re-scores
 * immediately: with values supplied the factors score from rules, with a
 * factor confirmed at default the conservative rating gets a review basis,
 * and if anything is still unknown the record stays in Needs review —
 * never a silent guess.
 *
 * The server action (app/actions/review.ts) is a thin wrapper that adds
 * request concerns only (form parsing, revalidation, redirect); the
 * full-flow script calls this directly so it exercises the real pipeline.
 */
export async function resolveReview(
  id: string,
  overlay: Record<string, unknown>,
  confirmFactorKeys: readonly FactorKey[] = []
): Promise<ResolutionOutcome> {
  const [record] = await db
    .select({
      status: shipments.status,
      intakeData: shipments.intakeData,
      confirmedFactors: shipments.confirmedFactors,
    })
    .from(shipments)
    .where(eq(shipments.id, id))
    .limit(1);

  if (!record) {
    return {
      ok: false,
      message: "Record not found. It may have been deleted.",
      fieldErrors: {},
    };
  }
  if (!canResolveReview(record.status)) {
    return {
      ok: false,
      message: `Record is ${record.status}; only records in Needs review can be resolved here.`,
      fieldErrors: {},
    };
  }
  const stored = shipmentIntakeSchema.safeParse(record.intakeData);
  if (!stored.success) {
    return {
      ok: false,
      message:
        "The stored record failed validation. Edit the full record instead.",
      fieldErrors: {},
    };
  }

  const merged = shipmentIntakeSchema.safeParse(
    mergeIntakeOverlay(stored.data, overlay)
  );
  if (!merged.success) {
    return {
      ok: false,
      message:
        "Some fields are invalid. Fix the highlighted fields and submit again.",
      fieldErrors: fieldErrorsFromZod(merged.error),
    };
  }

  const confirmed = confirmedFactorsToSchema(
    record.confirmedFactors ?? [],
    confirmFactorKeys
  );

  await db
    .update(shipments)
    .set({
      intakeData: merged.data,
      confirmedFactors: confirmed,
      updatedAt: new Date(),
    })
    .where(eq(shipments.id, id));

  await scoreShipmentRecord(id);
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { shipments } from "@/db/schema";
import { intakePayloadFromFormData } from "@/intake/form-data";
import { fieldErrorsFromZod } from "@/intake/form-errors";
import type { IntakeFormState } from "@/intake/form-state";
import { mergeIntakeOverlay } from "@/profile/record-edit";
import { canResolveReview } from "@/lifecycle/machine";
import {
  FACTOR_KEYS,
  shipmentIntakeSchema,
} from "@/schemas/shipment";
import { scoreShipmentRecord } from "@/scoring/service";

/**
 * Resolve a record's flagged fields from the review queue. The form posts
 * only the flagged fields (plus accept-at-default checkboxes); everything
 * else keeps its stored value. Saving re-scores immediately: with values
 * supplied the factors score from rules, with a factor confirmed at
 * default the conservative rating gets a review basis, and if anything is
 * still unknown the record stays in Needs review — never a silent guess.
 */
export async function resolveReviewRecord(
  id: string,
  _prev: IntakeFormState,
  formData: FormData
): Promise<IntakeFormState> {
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
      status: "error",
      message: "Record not found. It may have been deleted.",
      fieldErrors: {},
    };
  }
  if (!canResolveReview(record.status)) {
    return {
      status: "error",
      message: `Record is ${record.status}; only records in Needs review can be resolved here.`,
      fieldErrors: {},
    };
  }
  const stored = shipmentIntakeSchema.safeParse(record.intakeData);
  if (!stored.success) {
    return {
      status: "error",
      message:
        "The stored record failed validation. Edit the full record instead.",
      fieldErrors: {},
    };
  }

  const overlay = intakePayloadFromFormData(formData);
  const merged = shipmentIntakeSchema.safeParse(
    mergeIntakeOverlay(stored.data, overlay)
  );
  if (!merged.success) {
    return {
      status: "error",
      message:
        "Some fields are invalid. Fix the highlighted fields and submit again.",
      fieldErrors: fieldErrorsFromZod(merged.error),
    };
  }

  const confirmed = new Set(record.confirmedFactors ?? []);
  for (const key of FACTOR_KEYS) {
    if (formData.get(`confirm_factor_${key}`) === "on") {
      confirmed.add(key);
    }
  }

  await db
    .update(shipments)
    .set({
      intakeData: merged.data,
      confirmedFactors: [...confirmed],
      updatedAt: new Date(),
    })
    .where(eq(shipments.id, id));

  await scoreShipmentRecord(id);

  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath(`/shipments/${id}`);
  redirect(`/shipments/${id}`);
}

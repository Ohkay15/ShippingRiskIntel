"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { intakePayloadFromFormData } from "@/intake/form-data";
import type { IntakeFormState } from "@/intake/form-state";
import { resolveReview } from "@/review/resolution";
import {
  FACTOR_KEYS,
  type FactorKey,
} from "@/schemas/shipment";

/**
 * Resolve a record's flagged fields from the review queue. The form posts
 * only the flagged fields (plus accept-at-default checkboxes); everything
 * else keeps its stored value. Saving re-scores immediately — resolving a
 * record and seeing the fresh profile is ONE step, not two. All pipeline
 * logic lives in the resolution service so the full-flow script and this
 * action exercise the same code.
 */
export async function resolveReviewRecord(
  id: string,
  _prev: IntakeFormState,
  formData: FormData
): Promise<IntakeFormState> {
  const overlay = intakePayloadFromFormData(formData);
  const confirmed: FactorKey[] = [];
  for (const key of FACTOR_KEYS) {
    if (formData.get(`confirm_factor_${key}`) === "on") {
      confirmed.push(key);
    }
  }

  const outcome = await resolveReview(id, overlay, confirmed);
  if (!outcome.ok) {
    return {
      status: "error",
      message: outcome.message,
      fieldErrors: outcome.fieldErrors,
    };
  }

  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath(`/shipments/${id}`);
  redirect(`/shipments/${id}`);
}

"use server";

import { requireUser } from "@/auth/session";
import { revalidatePath } from "next/cache";

import { markActioned } from "@/lifecycle/actioned";
import {
  actionedPickInputs,
  pickSelectionError,
  picksFromFormValues,
} from "@/profile/picks";

export interface ActionPicksState {
  status: "idle" | "error";
  message: string | null;
}

/**
 * Action a record with the picks selected across BOTH recommendation
 * panels: one carrier, one insurance product, or one of each — a single
 * Scored → Actioned transition carrying every selected pick, so the
 * stored projection is one coherent post-action position (the engine
 * re-scores once with both substitutions). Refusals come back as inline
 * alerts, never as thrown errors.
 */
export async function actionWithPicks(
  shipmentId: string,
  _prev: ActionPicksState,
  formData: FormData
): Promise<ActionPicksState> {
  await requireUser();
  const picked = picksFromFormValues(formData.getAll("picks").map(String));
  const selectionError = pickSelectionError(picked);
  if (selectionError) {
    return { status: "error", message: selectionError };
  }

  const outcome = await markActioned(shipmentId, actionedPickInputs(picked));
  if (!outcome.ok) {
    return { status: "error", message: outcome.message };
  }

  revalidatePath(`/shipments/${shipmentId}`);
  revalidatePath("/");
  return { status: "idle", message: null };
}

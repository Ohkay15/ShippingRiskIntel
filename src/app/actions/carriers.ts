"use server";

import { revalidatePath } from "next/cache";

import { markActioned } from "@/lifecycle/actioned";

export interface PickCarrierState {
  status: "idle" | "error";
  message: string | null;
}

/**
 * Pick a carrier recommendation: runs the Scored → Actioned transition
 * (guards + projection inside markActioned) and revalidates so the profile
 * page re-renders in its Actioned state with the projected position.
 */
export async function pickCarrierRecommendation(
  shipmentId: string,
  carrierId: string,
  _prev: PickCarrierState,
  _formData: FormData
): Promise<PickCarrierState> {
  const outcome = await markActioned(shipmentId, { carrierRecommendationId: carrierId });
  if (!outcome.ok) {
    return { status: "error", message: outcome.message };
  }

  revalidatePath(`/shipments/${shipmentId}`);
  revalidatePath("/");
  return { status: "idle", message: null };
}

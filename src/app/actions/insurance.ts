"use server";

import { revalidatePath } from "next/cache";

import { markActioned } from "@/lifecycle/actioned";

export interface PickInsuranceState {
  status: "idle" | "error";
  message: string | null;
}

/**
 * Pick an insurance recommendation: runs the Scored → Actioned transition
 * (guards + projection inside markActioned) and revalidates so the profile
 * page re-renders in its Actioned state with the projected position.
 * Mirrors the carrier pick action; a carrier may still be picked alongside
 * the insurance product in the same transition.
 */
export async function pickInsuranceRecommendation(
  shipmentId: string,
  insuranceProductId: string,
  _prev: PickInsuranceState,
  _formData: FormData
): Promise<PickInsuranceState> {
  const outcome = await markActioned(shipmentId, { insuranceProductId });
  if (!outcome.ok) {
    return { status: "error", message: outcome.message };
  }

  revalidatePath(`/shipments/${shipmentId}`);
  revalidatePath("/");
  return { status: "idle", message: null };
}

"use server";

import { requireUser } from "@/auth/session";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { confirmAndExtract } from "@/extraction/confirmation";

export interface ConfirmState {
  status: "idle" | "error" | "done";
  message?: string;
}

const confirmInput = z.string().uuid();

/**
 * The human gate between upload and any scoring: an operator confirms a
 * draft record, extraction runs, the confidence gate routes the result.
 * This action NEVER scores — writing a Scored/Actioned status is owned by
 * later features. All pipeline logic lives in the confirmation service so
 * the full-flow script and this action exercise the same code.
 */
export async function confirmShipment(
  _prev: ConfirmState,
  formData: FormData
): Promise<ConfirmState> {
  await requireUser();
  const parsedId = confirmInput.safeParse(formData.get("shipmentId"));
  if (!parsedId.success) {
    return { status: "error", message: "Missing or invalid shipment id." };
  }
  const id = parsedId.data;

  const outcome = await confirmAndExtract(id);

  revalidatePath(`/shipments/${id}`);
  if (!outcome.ok) {
    return { status: "error", message: outcome.message };
  }
  revalidatePath("/review");
  return {
    status: "done",
    message: `Extraction complete (provider: ${outcome.providerName}). ${outcome.flaggedCount} field(s) need review below; the rest pre-filled automatically.`,
  };
}

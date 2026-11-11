"use server";

import { requireUser } from "@/auth/session";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { shipments } from "@/db/schema";
import { shipmentIntakeSchema } from "@/schemas/shipment";
import { intakePayloadFromFormData } from "@/intake/form-data";
import { fieldErrorsFromZod } from "@/intake/form-errors";
import type { IntakeFormState } from "@/intake/form-state";

/**
 * Create a draft shipment record from the intake form. The payload is
 * validated by the shared shipment schema — the same contract extraction
 * must satisfy — so a record created by hand and one created from a
 * document are structurally identical.
 */
export async function createShipment(
  _prev: IntakeFormState,
  formData: FormData
): Promise<IntakeFormState> {
  await requireUser();
  const payload = intakePayloadFromFormData(formData);
  const parsed = shipmentIntakeSchema.safeParse(payload);

  if (!parsed.success) {
    return {
      status: "error",
      message:
        "Some fields are invalid. Fix the highlighted fields and submit again.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const [row] = await db
    .insert(shipments)
    .values({ status: "draft", intakeData: parsed.data })
    .returning({ id: shipments.id });

  redirect(`/shipments/${row.id}`);
}

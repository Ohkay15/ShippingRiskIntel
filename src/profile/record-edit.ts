import { intakePayloadFromFormData } from "@/intake/form-data";
import { fieldErrorsFromZod } from "@/intake/form-errors";
import { shipmentIntakeSchema, type ShipmentIntake } from "@/schemas/shipment";

/**
 * Pure edit semantics for an existing shipment record. The edit form submits
 * the complete ten-factor wire payload (pre-filled fields, cleared fields as
 * empty), so the parsed result is a FULL replacement intake — a field the
 * operator cleared becomes null, never a stale leftover.
 */

export type RecordEditOutcome =
  | { ok: true; intake: ShipmentIntake; changed: boolean }
  | { ok: false; message: string; fieldErrors: Record<string, string> };

export function applyRecordEdit(
  previous: ShipmentIntake,
  formData: FormData
): RecordEditOutcome {
  const parsed = shipmentIntakeSchema.safeParse(intakePayloadFromFormData(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message:
        "Some fields are invalid. Fix the highlighted fields and submit again.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }
  return {
    ok: true,
    intake: parsed.data,
    changed: !intakeEquals(previous, parsed.data),
  };
}

/**
 * Equality over schema-validated intakes. Schema leaves are optional, so a
 * form-produced intake omits empty keys while a stored one may carry
 * explicit nulls — both mean "unknown". The canonicalizer folds
 * undefined → null before comparing, and even a one-character field edit
 * still counts as changed (the edit → re-score loop must not be skipped).
 */
export function intakeEquals(a: ShipmentIntake, b: ShipmentIntake): boolean {
  return canonicalize(a) === canonicalize(b);
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value != null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined && entry !== null)
      .map(([key, entry]) => [key, entry] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

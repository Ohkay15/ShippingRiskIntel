/**
 * Parsing of the picks form's checkbox values into a transition request —
 * pure so the server action stays a thin wrapper and the rules are
 * unit-testable. Card values are prefixed (`carrier:<id>` /
 * `insurance:<id>`) because carrier and insurer ids live in separate
 * matrices and could theoretically collide.
 */

export const CARRIER_PICK_PREFIX = "carrier:";
export const INSURANCE_PICK_PREFIX = "insurance:";

export interface PickedIds {
  carrierIds: string[];
  insuranceIds: string[];
}

export function picksFromFormValues(values: readonly string[]): PickedIds {
  const carrierIds: string[] = [];
  const insuranceIds: string[] = [];
  for (const value of values) {
    if (value.startsWith(CARRIER_PICK_PREFIX)) {
      carrierIds.push(value.slice(CARRIER_PICK_PREFIX.length));
    } else if (value.startsWith(INSURANCE_PICK_PREFIX)) {
      insuranceIds.push(value.slice(INSURANCE_PICK_PREFIX.length));
    }
  }
  return { carrierIds, insuranceIds };
}

/**
 * The transition request requires at least one pick and at most one per
 * matrix — the UI renders one checkbox per card, so multiples mean a
 * malformed form, which is refused rather than silently narrowed.
 */
export function pickSelectionError({ carrierIds, insuranceIds }: PickedIds): string | null {
  if (carrierIds.length === 0 && insuranceIds.length === 0) {
    return "Select at least one carrier or insurance product to action the record.";
  }
  if (carrierIds.length > 1) {
    return "Only one carrier can be actioned on a record.";
  }
  if (insuranceIds.length > 1) {
    return "Only one insurance product can be actioned on a record.";
  }
  return null;
}

/**
 * The markActioned transition inputs for a validated selection: one
 * carrier, one insurance product, or one of each — the single Scored →
 * Actioned transition carries every selected pick.
 */
export function actionedPickInputs({ carrierIds, insuranceIds }: PickedIds): {
  carrierRecommendationId: string | null;
  insuranceProductId: string | null;
} {
  return {
    carrierRecommendationId: carrierIds[0] ?? null,
    insuranceProductId: insuranceIds[0] ?? null,
  };
}

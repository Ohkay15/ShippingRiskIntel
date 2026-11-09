import type { FactorKey } from "@/schemas/shipment";
import { FACTOR_KEYS } from "@/schemas/shipment";

/**
 * Pure merge for the confirmed-factors column: previously confirmed factors
 * stay confirmed, newly resolved ones join, and non-factor junk is dropped.
 * A stale confirmation must not survive an edit that re-flagged the factor —
 * callers re-derive from the current flagged list, this only merges.
 */
export function confirmedFactorsToSchema(
  previous: readonly string[],
  newlyConfirmed: readonly FactorKey[]
): FactorKey[] {
  const valid = new Set<FactorKey>(FACTOR_KEYS);
  const merged = new Set<FactorKey>();
  for (const factor of previous) {
    if (valid.has(factor as FactorKey)) merged.add(factor as FactorKey);
  }
  for (const factor of newlyConfirmed) {
    merged.add(factor);
  }
  return [...merged];
}

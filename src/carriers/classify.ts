import type { ShipmentIntake } from "@/schemas/shipment";
import type { MatrixCell } from "@/scoring/engine";

import { laneRiskRank, type CargoCategory, type LaneRiskTier } from "./schema";

/**
 * Pure derivations that turn a shipment record and its profile into the
 * matching dimensions of the carrier fit matrix: cargo categories and lane
 * risk. No I/O, no LLM — the same record always classifies the same way.
 */

/**
 * Cargo categories for a record, used to match `supportedCargoTypes`.
 *
 * An unknown hazard class (null) adds no category: the record is already
 * flagged for review by the scoring engine, and guessing "not hazmat" here
 * could route dangerous goods to an unqualified carrier. Once the operator
 * fills the field, classification is exact.
 */
export function classifyCargo(record: ShipmentIntake): CargoCategory[] {
  const categories = new Set<CargoCategory>();

  const { hazardClass } = record.cargo_hazard;
  if (hazardClass != null && hazardClass !== "none") {
    categories.add("hazmat");
  }

  if (record.sensitivity.delaySensitivity === "perishable") {
    categories.add("perishable");
  }

  if (
    record.value_fragility.fragilityClass === "high" ||
    record.value_fragility.fragilityClass === "ultra"
  ) {
    categories.add("high_value_fragile");
  }

  if (categories.size === 0) {
    categories.add("general_dry");
  }
  return [...categories].sort();
}

/** Matrix cell → lane risk tier: how hostile is the route this record sits on. */
export function laneRiskFromCell(cell: MatrixCell): LaneRiskTier {
  switch (cell) {
    case "HH":
      return "high";
    case "HL":
    case "LH":
      return "medium";
    case "LL":
      return "low";
  }
}

/** True when a carrier can move every category the record classifies into. */
export function carrierSupportsCargo(
  carrierCategories: readonly CargoCategory[],
  recordCategories: readonly CargoCategory[]
): boolean {
  return recordCategories.every((category) => carrierCategories.includes(category));
}

/** True when a carrier accepts lanes at or below the record's risk tier. */
export function carrierAcceptsLaneRisk(
  carrierMax: LaneRiskTier,
  recordRisk: LaneRiskTier
): boolean {
  return laneRiskRank(carrierMax) >= laneRiskRank(recordRisk);
}

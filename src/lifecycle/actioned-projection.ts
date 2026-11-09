import {
  carrierMatches,
  factorDeltas,
  projectCarrierProfile,
  type FactorDelta,
} from "@/carriers/recommend";
import type { CarrierFitEntry, CarrierFitMatrix } from "@/carriers/schema";
import { PLACEHOLDER_CARRIER_FIT_MATRIX } from "@/carriers/matrix-data";
import type { RiskProfile } from "@/scoring/engine";
import type { FactorKey, ShipmentIntake } from "@/schemas/shipment";

/**
 * The Scored → Actioned projection (spec state table: "Profile locked with
 * chosen carrier; post-action score") as a pure function. The transition in
 * `actioned.ts` persists what this returns; tests exercise it without a
 * database.
 */

export interface ActionedProjection {
  carrier: CarrierFitEntry;
  /** The record re-scored with the chosen carrier's attributes. */
  projectedProfile: RiskProfile;
  /** Which factors the pick improved and by how much. */
  factorDeltas: FactorDelta[];
}

export type ActionedProjectionOutcome =
  | { ok: true; projection: ActionedProjection }
  | { ok: false; message: string };

export function buildActionedProjection(
  record: ShipmentIntake,
  profile: RiskProfile,
  carrierId: string,
  confirmedFactors: ReadonlySet<FactorKey> = new Set(),
  matrix: CarrierFitMatrix = PLACEHOLDER_CARRIER_FIT_MATRIX
): ActionedProjectionOutcome {
  const carrier = matrix.carriers.find((entry) => entry.id === carrierId);
  if (!carrier) {
    return {
      ok: false,
      message: `Carrier "${carrierId}" is not in the fit matrix — it may have been removed or renamed.`,
    };
  }
  if (!carrierMatches(record, profile, carrier)) {
    return {
      ok: false,
      message: `${carrier.name} does not match this shipment's cargo type, mode, or lane risk.`,
    };
  }

  const projectedProfile = projectCarrierProfile(record, carrier, confirmedFactors);
  return {
    ok: true,
    projection: {
      carrier,
      projectedProfile,
      factorDeltas: factorDeltas(profile, projectedProfile),
    },
  };
}

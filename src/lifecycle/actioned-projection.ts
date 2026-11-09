import {
  carrierMatches,
  factorDeltas,
  substituteCarrier,
  type FactorDelta,
} from "@/carriers/recommend";
import type { CarrierFitEntry, CarrierFitMatrix } from "@/carriers/schema";
import { PLACEHOLDER_CARRIER_FIT_MATRIX } from "@/carriers/matrix-data";
import { appliedCoverageUsd, insuranceMatches, substituteInsurance } from "@/insurance/recommend";
import { recommendCoverageLimit } from "@/insurance/limit";
import { PLACEHOLDER_INSURER_FIT_MATRIX } from "@/insurance/matrix-data";
import type { InsurerFitEntry, InsurerFitMatrix } from "@/insurance/schema";
import { DEFAULT_SCORING_CONFIG } from "@/scoring/config";
import { score } from "@/scoring/engine";
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
  // One projection implementation for every pick path — the carrier-only
  // flow delegates to the combined function and asserts the invariant it
  // relies on (a carrier-only pick always yields a carrier).
  const outcome = buildActionedProjectionFromPicks(record, profile, { carrierId }, confirmedFactors, matrix);
  if (!outcome.ok) {
    return outcome;
  }
  const { carrier, projectedProfile, factorDeltas: deltas } = outcome.projection;
  if (!carrier) {
    return { ok: false, message: "Carrier pick did not resolve to a carrier in the fit matrix." };
  }
  return {
    ok: true,
    projection: { carrier, projectedProfile, factorDeltas: deltas },
  };
}

/**
 * Either or both picks — a carrier recommendation, an insurance product,
 * or both — completing the Scored → Actioned transition. The projection
 * substitutes every pick's attributes into the record and re-scores ONCE,
 * so a combined pick is one coherent post-action position, not two
 * overlapping ones.
 */
export interface ActionedPicks {
  carrierId?: string | null;
  insuranceProductId?: string | null;
}

export interface PicksActionedProjection {
  /** Null when only an insurance product was picked. */
  carrier: CarrierFitEntry | null;
  /** Null when only a carrier was picked. */
  insuranceProduct: InsurerFitEntry | null;
  /** Coverage the insurance pick would actually provide; null without an insurance pick. */
  appliedInsuranceLimitUsd: number | null;
  projectedProfile: RiskProfile;
  factorDeltas: FactorDelta[];
}

export type PicksProjectionOutcome =
  | { ok: true; projection: PicksActionedProjection }
  | { ok: false; message: string };

export function buildActionedProjectionFromPicks(
  record: ShipmentIntake,
  profile: RiskProfile,
  picks: ActionedPicks,
  confirmedFactors: ReadonlySet<FactorKey> = new Set(),
  carrierMatrix: CarrierFitMatrix = PLACEHOLDER_CARRIER_FIT_MATRIX,
  insurerMatrix: InsurerFitMatrix = PLACEHOLDER_INSURER_FIT_MATRIX
): PicksProjectionOutcome {
  let working = record;
  let carrier: CarrierFitEntry | null = null;
  let product: InsurerFitEntry | null = null;
  let appliedInsuranceLimitUsd: number | null = null;

  const carrierId = picks.carrierId?.trim() || null;
  if (carrierId) {
    const found = carrierMatrix.carriers.find((entry) => entry.id === carrierId);
    if (!found) {
      return {
        ok: false,
        message: `Carrier "${carrierId}" is not in the fit matrix — it may have been removed or renamed.`,
      };
    }
    if (!carrierMatches(record, profile, found)) {
      return {
        ok: false,
        message: `${found.name} does not match this shipment's cargo type, mode, or lane risk.`,
      };
    }
    carrier = found;
    working = substituteCarrier(working, found);
  }

  const productId = picks.insuranceProductId?.trim() || null;
  if (productId) {
    const found = insurerMatrix.products.find((entry) => entry.id === productId);
    if (!found) {
      return {
        ok: false,
        message: `Insurance product "${productId}" is not in the insurer fit matrix — it may have been removed or renamed.`,
      };
    }
    if (!insuranceMatches(record, profile, found)) {
      return {
        ok: false,
        message: `${found.insurerName} ${found.productName} does not match this shipment's cargo type, mode, hazard class, or lane risk.`,
      };
    }
    product = found;
    const recommended = recommendCoverageLimit(record, profile).recommendedLimitUsd;
    appliedInsuranceLimitUsd = appliedCoverageUsd(found, recommended);
    working = substituteInsurance(working, found, recommended);
  }

  if (!carrier && !product) {
    return {
      ok: false,
      message: "At least one pick — a carrier or an insurance product — is required.",
    };
  }

  const projectedProfile = score(working, DEFAULT_SCORING_CONFIG, confirmedFactors);
  return {
    ok: true,
    projection: {
      carrier,
      insuranceProduct: product,
      appliedInsuranceLimitUsd,
      projectedProfile,
      factorDeltas: factorDeltas(profile, projectedProfile),
    },
  };
}

import { DEFAULT_SCORING_CONFIG } from "@/scoring/config";
import { score, type FactorRating, type RiskProfile } from "@/scoring/engine";
import type { FactorKey, ShipmentIntake } from "@/schemas/shipment";
import { factorContribution } from "@/profile/view-model";

import {
  carrierAcceptsLaneRisk,
  carrierSupportsCargo,
  classifyCargo,
  laneRiskFromCell,
} from "./classify";
import type { CarrierFitEntry, CarrierFitMatrix } from "./schema";

/**
 * The recommendation engine (spec §4 / roadmap Phase 4) — pure functions, no
 * I/O, no LLM. A recommendation is a projection: re-run the real scoring
 * engine on the record with the carrier's attributes substituted in, and
 * report which factor ratings moved and by how much the composite changed.
 * There are no rationale strings — every recommendation is concrete deltas,
 * and the projection is deterministic because the engine is.
 */

/** Per-factor movement between the current profile and a carrier projection. */
export interface FactorDelta {
  factor: FactorKey;
  before: { likelihood: number; consequence: number; contribution: number };
  after: { likelihood: number; consequence: number; contribution: number };
  /** after.contribution − before.contribution; negative = score improvement. */
  contributionDelta: number;
}

export interface CarrierRecommendation {
  carrier: CarrierFitEntry;
  /** Full re-scored profile with this carrier's attributes in the record. */
  projectedProfile: RiskProfile;
  /** projectedProfile.score − current score; negative = improvement. */
  scoreDelta: number;
  /** Only the factors whose ratings changed under this carrier. */
  factorDeltas: FactorDelta[];
}

/**
 * The record as it would read if this carrier carried the shipment: the
 * carrier-owned fields (carrier record ratings and the liability limit
 * term of the coverage factor) take the carrier's matrix values. The
 * shipper's own insurance amount is left untouched.
 */
export function substituteCarrier(record: ShipmentIntake, carrier: CarrierFitEntry): ShipmentIntake {
  return {
    ...record,
    carrier_record: {
      ...record.carrier_record,
      carrierId: carrier.id,
      carrierName: carrier.name,
      carrierSafetyRating: carrier.safetyRating,
      carrierClaimsRating: carrier.claimsRating,
    },
    coverage: {
      ...record.coverage,
      carrierLiabilityLimitUsd: carrier.liabilityLimitUsd,
    },
  };
}

/**
 * Re-score with the carrier substituted — the SAME pure engine that scored
 * the stored record, so a projection is a real score, not an estimate.
 */
export function projectCarrierProfile(
  record: ShipmentIntake,
  carrier: CarrierFitEntry,
  confirmedFactors: ReadonlySet<FactorKey> = new Set()
): RiskProfile {
  return score(substituteCarrier(record, carrier), DEFAULT_SCORING_CONFIG, confirmedFactors);
}

/** Whether a carrier can take this record: cargo type, mode, and lane risk. */
export function carrierMatches(
  record: ShipmentIntake,
  profile: RiskProfile,
  carrier: CarrierFitEntry
): boolean {
  if (!carrierSupportsCargo(carrier.supportedCargoTypes, classifyCargo(record))) {
    return false;
  }
  const mode = record.route_lane.mode;
  if (mode != null && !carrier.modes.includes(mode)) {
    return false;
  }
  return carrierAcceptsLaneRisk(carrier.maxLaneRisk, laneRiskFromCell(profile.cell));
}

function ratingDelta(before: FactorRating, after: FactorRating): FactorDelta {
  const beforeContribution = factorContribution(before);
  const afterContribution = factorContribution(after);
  return {
    factor: before.factor,
    before: {
      likelihood: before.likelihood,
      consequence: before.consequence,
      contribution: beforeContribution,
    },
    after: {
      likelihood: after.likelihood,
      consequence: after.consequence,
      contribution: afterContribution,
    },
    contributionDelta: round2(afterContribution - beforeContribution),
  };
}

/** Factors whose ratings changed between two profiles, ordered by |delta|. */
export function factorDeltas(before: RiskProfile, after: RiskProfile): FactorDelta[] {
  const afterByFactor = new Map(after.ratings.map((rating) => [rating.factor, rating]));
  return before.ratings
    .map((rating) => ratingDelta(rating, afterByFactor.get(rating.factor)!))
    .filter((delta) => delta.contributionDelta !== 0)
    .sort((a, b) => Math.abs(b.contributionDelta) - Math.abs(a.contributionDelta));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Top carriers for a scored record: filter the matrix by fit, project each
 * through the real engine, rank by projected composite (lowest risk wins),
 * take the top `limit`. Deterministic — same inputs, same recommendations.
 */
export function recommendCarriers(
  record: ShipmentIntake,
  profile: RiskProfile,
  matrix: CarrierFitMatrix,
  confirmedFactors: ReadonlySet<FactorKey> = new Set(),
  limit = 3
): CarrierRecommendation[] {
  return matrix.carriers
    .filter((carrier) => carrierMatches(record, profile, carrier))
    .map((carrier) => {
      const projectedProfile = projectCarrierProfile(record, carrier, confirmedFactors);
      return {
        carrier,
        projectedProfile,
        scoreDelta: round2(projectedProfile.score - profile.score),
        factorDeltas: factorDeltas(profile, projectedProfile),
      };
    })
    .sort(
      (a, b) =>
        a.projectedProfile.score - b.projectedProfile.score ||
        a.carrier.id.localeCompare(b.carrier.id)
    )
    .slice(0, limit);
}

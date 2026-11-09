import { DEFAULT_SCORING_CONFIG } from "@/scoring/config";
import { score, type RiskProfile } from "@/scoring/engine";
import { coverageGapUsd, type ShipmentIntake } from "@/schemas/shipment";
import { classifyCargo, laneRiskFromCell } from "@/carriers/classify";
import { laneRiskRank } from "@/carriers/schema";

import type { InsurerFitEntry, InsurerFitMatrix } from "./schema";

/**
 * The insurance recommendation engine — pure functions, no I/O, no LLM,
 * mirroring `carriers/recommend.ts`. A recommendation is a projection:
 * re-run the real scoring engine on the record with the product's coverage
 * substituted in, and report the projected coverage gap with the REAL gap
 * math (`coverageGapUsd`) — concrete dollar deltas, never generic
 * rationale strings. Deterministic because the engine is.
 */

/**
 * The coverage the product would actually provide on this shipment: the
 * product's per-shipment limit, capped by the recommended limit when the
 * operator asked for less (buying excess limit is not a recommendation).
 */
export function appliedCoverageUsd(
  product: InsurerFitEntry,
  recommendedLimitUsd: number | null
): number {
  if (recommendedLimitUsd == null || product.coverageLimitUsd <= recommendedLimitUsd) {
    return product.coverageLimitUsd;
  }
  return recommendedLimitUsd;
}

/** How the product's limit fits the recommended limit — or why it can't. */
export type LimitFit =
  | { kind: "covers_recommended"; productLimitUsd: number; appliedCoverageUsd: number }
  | {
      kind: "capped_by_product_limit";
      productLimitUsd: number;
      appliedCoverageUsd: number;
      /** recommended − product limit; how much of the recommendation the product cannot write. */
      shortfallUsd: number;
    }
  | {
      kind: "no_limit_guidance";
      productLimitUsd: number;
      appliedCoverageUsd: number;
    };

export function limitFit(product: InsurerFitEntry, recommendedLimitUsd: number | null): LimitFit {
  const applied = appliedCoverageUsd(product, recommendedLimitUsd);
  if (recommendedLimitUsd == null) {
    return { kind: "no_limit_guidance", productLimitUsd: product.coverageLimitUsd, appliedCoverageUsd: applied };
  }
  if (product.coverageLimitUsd >= recommendedLimitUsd) {
    return { kind: "covers_recommended", productLimitUsd: product.coverageLimitUsd, appliedCoverageUsd: applied };
  }
  return {
    kind: "capped_by_product_limit",
    productLimitUsd: product.coverageLimitUsd,
    appliedCoverageUsd: applied,
    shortfallUsd: recommendedLimitUsd - product.coverageLimitUsd,
  };
}

/**
 * The record as it would read if this product covered the shipment: the
 * insurance amount takes the product's applied coverage. The carrier's
 * contractual liability limit is left untouched — carrier liability and
 * shipper's cargo insurance are separate layers, and the gap math takes
 * the min of both.
 */
export function substituteInsurance(
  record: ShipmentIntake,
  product: InsurerFitEntry,
  recommendedLimitUsd: number | null
): ShipmentIntake {
  return {
    ...record,
    coverage: {
      ...record.coverage,
      insuranceCoverageUsd: appliedCoverageUsd(product, recommendedLimitUsd),
    },
  };
}

/**
 * Whether a product can cover this record: cargo category, mode, hazard
 * class, and lane risk. An UNKNOWN hazard class (null) does not
 * disqualify a product — the record is already flagged for review, and
 * guessing "not hazmat" would be exactly the kind of silent assumption
 * this product refuses to make; the filter resumes once the field is
 * filled.
 */
export function insuranceMatches(
  record: ShipmentIntake,
  profile: RiskProfile,
  product: InsurerFitEntry
): boolean {
  const recordCategories = classifyCargo(record);
  if (!recordCategories.every((category) => product.supportedCargoTypes.includes(category))) {
    return false;
  }

  const mode = record.route_lane.mode;
  if (mode != null && !product.modes.includes(mode)) {
    return false;
  }

  const hazardClass = record.cargo_hazard.hazardClass;
  if (hazardClass != null && !product.supportedHazardClasses.includes(hazardClass)) {
    return false;
  }

  return laneRiskRank(product.maxLaneRisk) >= laneRiskRank(laneRiskFromCell(profile.cell));
}

export interface InsuranceRecommendation {
  product: InsurerFitEntry;
  /** From the limit-guidance engine; null when no declared value is on file. */
  recommendedLimitUsd: number | null;
  /** Coverage the product would actually provide: product limit capped by the recommended limit. */
  providedCoverageUsd: number;
  limitFit: LimitFit;
  /** The record's carrier liability limit — the OTHER layer the gap math mins with. Null when absent. */
  carrierLiabilityLimitUsd: number | null;
  /** Real gap math on the record after taking the product. Null when value or coverage data is absent. */
  projectedGapUsd: number | null;
  /** projectedGap − current gap; negative = exposure closed. Null when either gap is unknown. */
  gapDeltaUsd: number | null;
  /** The record re-scored with the product's coverage substituted — the pick projection's input. */
  projectedProfile: RiskProfile;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Top insurance products for a scored record: filter the matrix by fit,
 * project each through the real engine, rank by projected coverage gap
 * (lowest exposure wins), take the top `limit`. Deterministic — same
 * inputs, same recommendations.
 */
export function recommendInsurance(
  record: ShipmentIntake,
  profile: RiskProfile,
  matrix: InsurerFitMatrix,
  recommendedLimitUsd: number | null,
  limit = 3
): InsuranceRecommendation[] {
  return matrix.products
    .filter((product) => insuranceMatches(record, profile, product))
    .map((product) => {
      const projectedProfile = score(
        substituteInsurance(record, product, recommendedLimitUsd),
        DEFAULT_SCORING_CONFIG
      );
      // The REAL gap math — declared value − min(coverage, liability) — on
      // the substituted record, not a parallel estimate.
      const substituted = substituteInsurance(record, product, recommendedLimitUsd);
      const projectedGapUsd = coverageGapUsd(record.value_fragility, substituted.coverage);
      const gapDeltaUsd =
        projectedGapUsd != null && profile.coverageGapUsd != null
          ? round2(projectedGapUsd - profile.coverageGapUsd)
          : null;
      return {
        product,
        recommendedLimitUsd,
        providedCoverageUsd: appliedCoverageUsd(product, recommendedLimitUsd),
        limitFit: limitFit(product, recommendedLimitUsd),
        carrierLiabilityLimitUsd: record.coverage.carrierLiabilityLimitUsd ?? null,
        projectedGapUsd,
        gapDeltaUsd,
        projectedProfile,
      };
    })
    .sort(
      (a, b) =>
        (a.projectedGapUsd ?? Infinity) - (b.projectedGapUsd ?? Infinity) ||
        a.product.id.localeCompare(b.product.id)
    )
    .slice(0, limit);
}

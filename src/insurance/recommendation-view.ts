import { formatUsd } from "@/coverage/display";

import type { CoverageLimitRecommendation, LimitBuffer } from "./limit";
import type { InsuranceRecommendation, LimitFit } from "./recommend";

/**
 * Pure view model for the coverage-limit guidance and insurance
 * recommendation panels — the insurance counterpart to
 * `carriers/recommendation-view.ts`. Named, testable transformations; the
 * React components only render what these return. Every dollar figure is
 * concrete, and a missing gap figure reads "unknown" — never $0, never a
 * guess.
 */

/** How a single gap figure reads on a card: concrete dollars, or unknown. */
export function gapStateText(gapUsd: number | null): string {
  if (gapUsd == null) return "gap unknown";
  if (gapUsd > 0) return `${formatUsd(gapUsd)} uncovered`;
  if (gapUsd === 0) return "gap closed";
  return `${formatUsd(-gapUsd)} surplus`;
}

/** Short signed form for the card head, mirroring the carrier score delta. */
export function gapDeltaShortText(gapDeltaUsd: number | null): string {
  if (gapDeltaUsd == null) return "unknown";
  if (gapDeltaUsd === 0) return "±$0";
  return gapDeltaUsd < 0
    ? `−${formatUsd(-gapDeltaUsd)}`
    : `+${formatUsd(gapDeltaUsd)}`;
}

/** Plain-language sentence for how the product's limit fits the recommendation. */
export function limitFitText(fit: LimitFit): string {
  switch (fit.kind) {
    case "covers_recommended":
      return `Covers the ${formatUsd(fit.appliedCoverageUsd)} recommended limit in full.`;
    case "capped_by_product_limit":
      return `${formatUsd(fit.shortfallUsd)} short of the ${formatUsd(fit.productLimitUsd)} limit it can write.`;
    case "no_limit_guidance":
      return `No limit guidance on this record — quoted at the product's full ${formatUsd(fit.productLimitUsd)} limit.`;
  }
}

export type LimitGuidanceStatus = "adequate" | "shortfall" | "coverage_unknown" | "no_guidance";

export interface LimitGuidanceView {
  /** Formatted recommended limit, null when no declared value is on file. */
  headline: string | null;
  rationale: string;
  buffers: readonly Pick<LimitBuffer, "label" | "percent">[];
  status: LimitGuidanceStatus;
  /** Dollars between the recommendation and current coverage; null unless status is "shortfall". */
  shortfallText: string | null;
}

export function limitGuidanceView(
  recommendation: CoverageLimitRecommendation
): LimitGuidanceView {
  const recommendedLimitUsd = recommendation.recommendedLimitUsd;
  const status: LimitGuidanceStatus =
    recommendedLimitUsd == null
      ? "no_guidance"
      : recommendation.currentlyAdequate == null
        ? "coverage_unknown"
        : recommendation.currentlyAdequate
          ? "adequate"
          : "shortfall";

  return {
    headline: recommendedLimitUsd == null ? null : formatUsd(recommendedLimitUsd),
    rationale: recommendation.rationale,
    buffers: recommendation.buffers.map((buffer) => ({
      label: buffer.label,
      percent: buffer.percent,
    })),
    status,
    shortfallText:
      recommendedLimitUsd != null &&
      recommendation.currentlyAdequate === false &&
      recommendation.currentEffectiveCoverageUsd != null
        ? formatUsd(recommendedLimitUsd - recommendation.currentEffectiveCoverageUsd)
        : null,
  };
}

export interface InsuranceProductView {
  productId: string;
  /** "Insurer A — Marine Cargo": insurer and product in one line. */
  title: string;
  liabilityTerms: string;
  notes: string | null;
  /** Coverage the product would actually provide (product limit capped by the recommendation). */
  providedCoverageText: string;
  limitFitText: string;
  /** The card's "before" figure — the record's current coverage gap. */
  gapBeforeText: string;
  /** The card's "after" figure — the gap with this product applied. */
  gapAfterText: string;
  /** Concrete dollars of exposure closed or added by the pick. */
  gapDeltaText: string;
  /** Short signed delta for the card head, mirroring the carrier score delta. */
  gapDeltaShortText: string;
  improves: boolean;
  projectedScore: number;
  /**
   * What the product's coverage is actually worth after min(insurance,
   * carrier liability) — and when the carrier's liability limit, not the
   * product, is the binding cap. Null when the liability limit is absent.
   */
  effectiveCoverageText: string | null;
  /** True when the carrier's liability limit caps this product's coverage. */
  cappedByCarrierLiability: boolean;
}

function gapDeltaSentence(gapDeltaUsd: number | null): string {
  if (gapDeltaUsd == null) return "Exposure change unknown — a gap figure is missing.";
  if (gapDeltaUsd === 0) return "No change in exposure.";
  return gapDeltaUsd < 0
    ? `${formatUsd(-gapDeltaUsd)} of exposure closed.`
    : `${formatUsd(gapDeltaUsd)} of exposure added.`;
}

export function insuranceRecommendationViews(
  recommendations: readonly InsuranceRecommendation[],
  currentGapUsd: number | null
): InsuranceProductView[] {
  return recommendations.map((rec) => {
    const liability = rec.carrierLiabilityLimitUsd;
    const effective =
      liability == null ? rec.providedCoverageUsd : Math.min(rec.providedCoverageUsd, liability);
    const cappedByCarrierLiability = liability != null && rec.providedCoverageUsd > liability;

    return {
      productId: rec.product.id,
      title: `${rec.product.insurerName} — ${rec.product.productName}`,
      liabilityTerms: rec.product.liabilityTerms,
      notes: rec.product.notes ?? null,
      providedCoverageText: `${formatUsd(rec.providedCoverageUsd)} per-shipment coverage`,
      limitFitText: limitFitText(rec.limitFit),
      gapBeforeText: gapStateText(currentGapUsd),
      gapAfterText: gapStateText(rec.projectedGapUsd),
      gapDeltaText: gapDeltaSentence(rec.gapDeltaUsd),
      gapDeltaShortText: gapDeltaShortText(rec.gapDeltaUsd),
      improves: rec.gapDeltaUsd != null && rec.gapDeltaUsd < 0,
      projectedScore: rec.projectedProfile.score,
      effectiveCoverageText:
        liability == null
          ? null
          : cappedByCarrierLiability
            ? `${formatUsd(effective)} after the carrier's ${formatUsd(liability)} liability limit — the binding cap, not this product.`
            : `${formatUsd(effective)} (above the carrier's ${formatUsd(liability)} liability limit).`,
      cappedByCarrierLiability,
    };
  });
}

import { FACTOR_GROUP_META } from "@/intake/form-fields";
import type { FactorKey } from "@/schemas/shipment";
import type { RiskProfile } from "@/scoring/engine";

import { factorDeltas, type CarrierRecommendation, type FactorDelta } from "./recommend";

/**
 * Pure view model for the carrier recommendation and Actioned panels —
 * named, testable transformations; the React components only render what
 * these return. Factor labels come from the same registry the intake form
 * uses, so a factor reads the same everywhere in the product.
 */
export function factorLabel(factor: FactorKey): string {
  const group = FACTOR_GROUP_META.find((meta) => meta.key === factor);
  return group?.title ?? factor;
}

export interface FactorDeltaView {
  key: FactorKey;
  label: string;
  /** "5 × 4" — likelihood × consequence before the pick. */
  beforeText: string;
  /** "1 × 2" — projected likelihood × consequence. */
  afterText: string;
  /** Signed contribution delta on the 1–25 composite scale. */
  deltaText: string;
  improves: boolean;
}

export function factorDeltaViews(deltas: readonly FactorDelta[]): FactorDeltaView[] {
  return deltas.map((delta) => ({
    key: delta.factor,
    label: factorLabel(delta.factor),
    beforeText: `${delta.before.likelihood} × ${delta.before.consequence}`,
    afterText: `${delta.after.likelihood} × ${delta.after.consequence}`,
    deltaText:
      delta.contributionDelta > 0
        ? `+${delta.contributionDelta.toFixed(2)}`
        : delta.contributionDelta.toFixed(2),
    improves: delta.contributionDelta < 0,
  }));
}

export interface RecommendationView {
  carrierId: string;
  carrierName: string;
  notes: string | null;
  liabilityLimitUsd: number;
  hazmatCertifications: readonly string[];
  projectedScore: number;
  scoreDeltaText: string;
  improves: boolean;
  factors: FactorDeltaView[];
}

export function recommendationViews(
  recommendations: readonly CarrierRecommendation[]
): RecommendationView[] {
  return recommendations.map((rec) => ({
    carrierId: rec.carrier.id,
    carrierName: rec.carrier.name,
    notes: rec.carrier.notes ?? null,
    liabilityLimitUsd: rec.carrier.liabilityLimitUsd,
    hazmatCertifications: rec.carrier.hazmatCertifications,
    projectedScore: rec.projectedProfile.score,
    scoreDeltaText:
      rec.scoreDelta > 0 ? `+${rec.scoreDelta.toFixed(2)}` : rec.scoreDelta.toFixed(2),
    improves: rec.scoreDelta < 0,
    factors: factorDeltaViews(rec.factorDeltas),
  }));
}

export interface ActionedView {
  carrierName: string;
  carrierFound: boolean;
  projectedScore: number | null;
  projectedCell: RiskProfile["cell"] | null;
  currentScore: number;
  factors: FactorDeltaView[];
}

/** The Actioned panel's view: chosen carrier plus the stored projection. */
export function actionedView(
  carrierId: string | null,
  carrierName: string | null,
  storedProfile: RiskProfile,
  projectedProfile: RiskProfile | null
): ActionedView {
  return {
    carrierName: carrierName ?? carrierId ?? "Unknown carrier",
    carrierFound: carrierName != null,
    projectedScore: projectedProfile?.score ?? null,
    projectedCell: projectedProfile?.cell ?? null,
    currentScore: storedProfile.score,
    factors:
      projectedProfile != null ? factorDeltaViews(factorDeltas(storedProfile, projectedProfile)) : [],
  };
}

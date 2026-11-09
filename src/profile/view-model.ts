import type { FactorBasis, FactorRating, RiskProfile } from "@/scoring/engine";
import type { FactorKey } from "@/schemas/shipment";
import { FACTOR_GROUP_META } from "@/intake/form-fields";
import type { MatrixCell } from "@/scoring/engine";

/**
 * Pure view-model for the profile detail page. Every function here is a
 * named, testable transformation — the React page only renders what these
 * return. Nothing here touches the database or the engine.
 */

const FACTOR_LABELS: Record<FactorKey, string> = Object.fromEntries(
  FACTOR_GROUP_META.map((group) => [group.key, group.title])
) as Record<FactorKey, string>;

export interface FactorBasisView {
  kind: "rule" | "llm" | "review" | "default";
  /** Short chip label, e.g. "Rule fired" / "LLM judgment". */
  label: string;
  /** The specific justification: rule id + note, LLM evidence + confidence. */
  detail: string;
  /** 0–1, LLM basis only. */
  confidence: number | null;
}

export function factorBasisView(basis: FactorBasis): FactorBasisView {
  switch (basis.source) {
    case "rule":
      return {
        kind: "rule",
        label: "Rule",
        detail: basis.note
          ? `${basis.ruleId} — ${basis.note}`
          : `${basis.ruleId} matched`,
        confidence: null,
      };
    case "llm":
      return {
        kind: "llm",
        label: "LLM judgment",
        detail: basis.evidence,
        confidence: basis.confidence,
      };
    case "review":
      return {
        kind: "review",
        label: "Confirmed",
        detail: `Confirmed by ${basis.reviewerId} in the review queue`,
        confidence: null,
      };
    case "default":
      return {
        kind: "default",
        label: "Conservative default",
        detail: basis.reason,
        confidence: null,
      };
  }
}

/** Weighted contribution of a factor to the composite score (1–25 scale). */
export function factorContribution(rating: FactorRating): number {
  return Math.round(rating.likelihood * rating.consequence * rating.weight * 100) / 100;
}

export interface FactorRowView {
  key: FactorKey;
  label: string;
  likelihood: number;
  consequence: number;
  weight: number;
  contribution: number;
  basis: FactorBasisView;
}

/** Ratings ordered by contribution — the drivers that move the score lead. */
export function factorRows(profile: RiskProfile): FactorRowView[] {
  return [...profile.ratings]
    .map((rating) => ({
      key: rating.factor,
      label: FACTOR_LABELS[rating.factor],
      likelihood: rating.likelihood,
      consequence: rating.consequence,
      weight: rating.weight,
      contribution: factorContribution(rating),
      basis: factorBasisView(rating.basis),
    }))
    .sort((a, b) => b.contribution - a.contribution || a.key.localeCompare(b.key));
}

export interface MatrixPlacement {
  cell: MatrixCell;
  /** Percent along the likelihood axis (1 → 0%, 5 → 100%). */
  likelihoodPct: number;
  /** Percent along the consequence axis (1 → 0%, 5 → 100%). */
  consequencePct: number;
}

export function matrixPlacement(profile: RiskProfile): MatrixPlacement {
  return {
    cell: profile.cell,
    likelihoodPct: ((profile.likelihoodIndex - 1) / 4) * 100,
    consequencePct: ((profile.consequenceIndex - 1) / 4) * 100,
  };
}

/** Short factual line for the record header: what is moving, where. */
export function recordSummary(intake: {
  cargo_hazard: { cargoDescription?: string | null; unNumber?: string | null };
  route_lane: {
    origin?: string | null;
    destination?: string | null;
    mode?: string | null;
    laneId?: string | null;
  };
  value_fragility: { declaredValueUsd?: number | null };
}): string {
  const route =
    intake.route_lane.origin && intake.route_lane.destination
      ? `${intake.route_lane.origin} → ${intake.route_lane.destination}`
      : (intake.route_lane.laneId ?? null);
  const parts = [
    intake.cargo_hazard.cargoDescription,
    route,
    intake.route_lane.mode,
  ].filter((part): part is string => part != null && part.length > 0);
  return parts.join(" · ") || "No description recorded";
}

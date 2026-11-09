import {
  FACTOR_KEYS,
  coverageGapUsd,
  type FactorKey,
  type ShipmentIntake,
} from "../schemas/shipment";
import { evaluateCondition, resolveField } from "./conditions";
import { DEFAULT_SCORING_CONFIG, type Rating, type ScoringConfig } from "./config";

/**
 * The deterministic scoring core (spec §2).
 *
 * `score` is a pure function: same record + same config → identical profile,
 * every time. No I/O, no network, no clock, no randomness, and the LLM never
 * participates — factor ratings derive from config rules over the structured
 * record. Callers must parse the record with `shipmentIntakeSchema` before
 * scoring; missing field data (null) is expected and handled via conservative
 * defaults plus review flags, never guesses and never a crash.
 *
 * Reading the profile: the composite score is the weighted sum of per-factor
 * likelihood × consequence products on a 1–25 scale; the matrix cell is the
 * shipment's position after likelihood/consequence rollup; every factor
 * rating carries the basis that produced it for full explainability.
 */

export type MatrixCell = "LL" | "LH" | "HL" | "HH";

/**
 * Where a rating came from — the UI renders this next to every rating
 * (spec: "the system presents its case, the human validates the logic").
 * The `llm` and `review` variants are produced by later phases (extraction
 * judgment, review-queue resolution); this engine emits `rule` and `default`.
 */
export type FactorBasis =
  | { source: "rule"; ruleId: string; note?: string }
  | { source: "llm"; confidence: number; evidence: string }
  | { source: "review"; reviewerId: string }
  | { source: "default"; reason: string };

export interface FactorRating {
  factor: FactorKey;
  likelihood: Rating;
  consequence: Rating;
  /** From scoring config; sums to 1.0 across the ten factors. */
  weight: number;
  basis: FactorBasis;
}

export interface ReviewFlag {
  factor: FactorKey;
  reason: string;
}

export interface RiskProfile {
  /** Weighted composite of per-factor likelihood × consequence, 1–25 scale. */
  score: number;
  /** Matrix position after likelihood/consequence rollup. */
  cell: MatrixCell;
  /** Weighted-average ratings — the coordinates behind the cell. */
  /**
   * Rolled-up likelihood axis (weighted mean of factor likelihoods, 1–5).
   * A weighted mean fits likelihood: it aggregates many independent chances.
   */
  likelihoodIndex: number;
  /**
   * Rolled-up consequence axis (mean of the two highest factor consequences,
   * 1–5). Consequence is worst-case-dominated — a single catastrophic factor
   * must keep the axis high; a plain weighted mean would dilute it and clump
   * the matrix mid-band.
   */
  consequenceIndex: number;
  /** Full factor breakdown; every rating shows its basis in the UI. */
  ratings: readonly FactorRating[];
  /**
   * Declared value − min(coverage, carrier liability limit), in USD.
   * Null means coverage data is absent — callers must render that as
   * "unknown", never $0 (a missing-coverage record showing a $0 gap would
   * read as fully covered).
   */
  coverageGapUsd: number | null;
  /** True when any factor was rated from a conservative default. */
  needsReview: boolean;
  reviewFlags: readonly ReviewFlag[];
}

interface RecordView {
  record: ShipmentIntake;
  /**
   * Engine-derived values rules can reference by dotted path
   * ("derived.coverageGapUsd"). Pure recomputations from the record.
   */
  derived: {
    coverageGapUsd: number | null;
    /** Gap as a share of declared value — null when value or gap unknown. */
    coverageGapRatio: number | null;
    activeDisruptionCount: number;
  };
}

/**
 * Factors the operator explicitly accepted at their conservative default
 * rating in the review queue (spec: "Accept, correct, or fill fields").
 *
 * A confirmed factor never raises a review flag: while its required data is
 * still missing it is rated at the conservative default with a human
 * `review` basis; once the data arrives the ordinary rules rate it again —
 * a confirmation only covers the missing-data case, never overrides real
 * data. Empty by default; the composite remains a pure function of record,
 * config, and this set.
 */
export const OPERATOR_REVIEWER_ID = "operator";

export function score(
  record: ShipmentIntake,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
  confirmedFactors: ReadonlySet<FactorKey> = new Set()
): RiskProfile {
  const view = buildRecordView(record);
  const ratings = FACTOR_KEYS.map((factor) =>
    rateFactor(factor, view, config, confirmedFactors)
  );

  const likelihoodIndex = round2(weightedMean(ratings, "likelihood"));
  const consequenceIndex = round2(topTwoMean(ratings));
  const composite = round2(
    ratings.reduce((total, rating) => total + rating.weight * rating.likelihood * rating.consequence, 0)
  );
  const flags = reviewFlags(ratings, config);

  return {
    score: composite,
    cell: toCell(likelihoodIndex, consequenceIndex, config.matrixSplitAt),
    likelihoodIndex,
    consequenceIndex,
    ratings,
    coverageGapUsd: view.derived.coverageGapUsd,
    needsReview: flags.length > 0,
    reviewFlags: flags,
  };
}

function buildRecordView(record: ShipmentIntake): RecordView {
  const gap = coverageGapUsd(record.value_fragility, record.coverage);
  const declaredValue = record.value_fragility.declaredValueUsd ?? null;
  return {
    record,
    derived: {
      coverageGapUsd: gap,
      // Declared value is positive per the intake schema, so this never divides by zero.
      coverageGapRatio: gap != null && declaredValue != null ? round2(gap / declaredValue) : null,
      activeDisruptionCount: record.live_conditions.conditions.filter(
        (condition) => condition !== "none_reported"
      ).length,
    },
  };
}

function rateFactor(
  factor: FactorKey,
  view: RecordView,
  config: ScoringConfig,
  confirmedFactors: ReadonlySet<FactorKey>
): FactorRating {
  const ruleSet = config.rules[factor];
  const weight = config.weights[factor];

  const missing = ruleSet.requiredFields.filter((path) => !resolveField(view, path).present);
  if (missing.length > 0) {
    return confirmedFactors.has(factor)
      ? confirmedDefaultRating(factor, weight, config.defaults)
      : defaultRating(factor, weight, config, `Missing required data: ${missing.join(", ")}`);
  }

  for (const rule of ruleSet.rules) {
    if (evaluateCondition(rule.when, view)) {
      return {
        factor,
        likelihood: rule.likelihood,
        consequence: rule.consequence,
        weight,
        basis: { source: "rule", ruleId: rule.id, note: rule.note },
      };
    }
  }

  return confirmedFactors.has(factor)
    ? confirmedDefaultRating(factor, weight, config.defaults)
    : defaultRating(
        factor,
        weight,
        config,
        "No rule matched the available data — possible config coverage gap"
      );
}

function defaultRating(
  factor: FactorKey,
  weight: number,
  config: ScoringConfig,
  reason: string
): FactorRating {
  return {
    factor,
    likelihood: config.defaults.likelihood,
    consequence: config.defaults.consequence,
    weight,
    basis: { source: "default", reason },
  };
}

/** The operator accepted the conservative default in the review queue. */
function confirmedDefaultRating(
  factor: FactorKey,
  weight: number,
  defaults: ScoringConfig["defaults"]
): FactorRating {
  return {
    factor,
    likelihood: defaults.likelihood,
    consequence: defaults.consequence,
    weight,
    basis: { source: "review", reviewerId: OPERATOR_REVIEWER_ID },
  };
}

function reviewFlags(ratings: readonly FactorRating[], config: ScoringConfig): ReviewFlag[] {
  if (!config.defaults.flaggedForReview) {
    return [];
  }
  return ratings
    .filter((rating): rating is FactorRating & { basis: Extract<FactorBasis, { source: "default" }> } =>
      rating.basis.source === "default"
    )
    .map((rating) => ({ factor: rating.factor, reason: rating.basis.reason }));
}

/** Weights sum to 1.0 (config-validated), so the weighted sum is a mean. */
function weightedMean(ratings: readonly FactorRating[], axis: "likelihood" | "consequence"): number {
  return ratings.reduce((total, rating) => total + rating.weight * rating[axis], 0);
}

/**
 * Mean of the two highest factor consequences. A single severe factor keeps
 * the consequence axis high; ten benign factors keep it low.
 */
function topTwoMean(ratings: readonly FactorRating[]): number {
  const topTwo = ratings
    .map((rating) => rating.consequence)
    .sort((a, b) => b - a)
    .slice(0, 2);
  return topTwo.reduce((sum, value) => sum + value, 0) / topTwo.length;
}

function toCell(likelihoodIndex: number, consequenceIndex: number, splitAt: number): MatrixCell {
  const highLikelihood = likelihoodIndex > splitAt;
  const highConsequence = consequenceIndex > splitAt;
  if (highLikelihood && highConsequence) {
    return "HH";
  }
  if (highLikelihood) {
    return "HL";
  }
  if (highConsequence) {
    return "LH";
  }
  return "LL";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

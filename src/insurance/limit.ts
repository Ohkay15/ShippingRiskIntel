import { formatUsd } from "@/coverage/display";
import type { FactorKey } from "@/schemas/shipment";
import { effectiveCoverageUsd, type ShipmentIntake } from "@/schemas/shipment";
import type { RiskProfile } from "@/scoring/engine";

/**
 * Coverage-limit guidance (generation-2 enhancement): recommend an insurance
 * limit per scored shipment, derived from the record's declared value plus
 * buffer drivers read from the same structured fields the engine rates
 * (fragility, delay sensitivity, escalation exposure). The current
 * coverage-gap math (`effectiveCoverageUsd`, the profile's stored gap)
 * answers "does the record's coverage already meet that limit?" — and the
 * answer can be "unknown" when coverage data is absent, never a guess.
 *
 * Pure function over the record and its scored profile — no I/O, no LLM.
 * The engine's factor ratings for the buffer-driving factors are returned
 * as evidence so the limit recommendation shows its case like every other
 * output of this product.
 */

/** One buffer driver applied on top of the declared value. */
export interface LimitBuffer {
  driver: "fragility" | "sensitivity" | "escalation";
  /** Plain-language label used inside the rationale. */
  label: string;
  percent: number;
}

/** The scored factor ratings the buffer drivers come from, as evidence. */
export interface LimitEvidence {
  factor: FactorKey;
  likelihood: number;
  consequence: number;
}

export interface CoverageLimitRecommendation {
  /** Declared value plus buffers, rounded up to the nearest $1,000. Null when no declared value is on file. */
  recommendedLimitUsd: number | null;
  declaredValueUsd: number | null;
  buffers: LimitBuffer[];
  totalBufferPercent: number;
  /** Plain-language rationale: what the limit covers and why. */
  rationale: string;
  /** min(coverage, carrier liability limit) currently on the record; null when no coverage data. */
  currentEffectiveCoverageUsd: number | null;
  /**
   * Whether current effective coverage meets the recommended limit.
   * Null when coverage data is absent — unknown is its own state, never
   * "not adequate" and never "covered".
   */
  currentlyAdequate: boolean | null;
  /** The record's stored coverage gap, for reference next to the guidance. */
  currentGapUsd: number | null;
  evidence: LimitEvidence[];
}

/** Factors whose ratings justify the buffer — evidence, not decoration. */
const BUFFER_FACTORS: FactorKey[] = ["value_fragility", "sensitivity", "escalation"];

/** Buffer percentages by fragility class — low cargo needs no premium. */
const FRAGILITY_BUFFERS: Partial<Record<string, { label: string; percent: number }>> = {
  medium: { label: "medium-fragility cargo", percent: 5 },
  high: { label: "high-fragility cargo", percent: 15 },
  ultra: { label: "ultra-fragile cargo", percent: 30 },
};

/** Round UP to the nearest $1,000 — a limit is a floor, never a haircut. */
function roundUpToThousand(usd: number): number {
  return Math.ceil(usd / 1000) * 1000;
}

function collectBuffers(record: ShipmentIntake): LimitBuffer[] {
  const buffers: LimitBuffer[] = [];

  const fragility = FRAGILITY_BUFFERS[record.value_fragility.fragilityClass ?? "low"];
  if (fragility) {
    buffers.push({ driver: "fragility", label: fragility.label, percent: fragility.percent });
  }

  switch (record.sensitivity.delaySensitivity) {
    case "perishable":
      buffers.push({ driver: "sensitivity", label: "perishable timing risk", percent: 10 });
      break;
    case "jit":
      buffers.push({ driver: "sensitivity", label: "just-in-time delivery risk", percent: 5 });
      break;
  }

  if (record.escalation.escalationExposure === "spreads") {
    buffers.push({
      driver: "escalation",
      label: "losses that spread beyond the initial incident",
      percent: 10,
    });
  }

  return buffers;
}

function coverageSentence(
  effective: number | null,
  recommended: number
): string {
  if (effective == null) {
    return (
      "Coverage terms are missing on this record, so whether the limit is " +
      "met cannot be confirmed — absence of coverage data is never treated " +
      "as covered. Enter coverage to close the loop."
    );
  }
  if (effective >= recommended) {
    return `Current effective coverage of ${formatUsd(effective)} already meets this limit.`;
  }
  return (
    `Current effective coverage of ${formatUsd(effective)} leaves ` +
    `${formatUsd(recommended - effective)} of the recommended limit uncovered.`
  );
}

/**
 * Recommend an insurance limit for a scored shipment. Buffers key off the
 * record's structured fields; the profile supplies the current gap and the
 * factor ratings cited as evidence. Deterministic: same record + profile,
 * same recommendation.
 */
export function recommendCoverageLimit(
  record: ShipmentIntake,
  profile: RiskProfile
): CoverageLimitRecommendation {
  const declaredValueUsd = record.value_fragility.declaredValueUsd;
  const effective = effectiveCoverageUsd(record.coverage);
  const evidence = profile.ratings
    .filter((rating) => BUFFER_FACTORS.includes(rating.factor))
    .map((rating) => ({
      factor: rating.factor,
      likelihood: rating.likelihood,
      consequence: rating.consequence,
    }));

  if (declaredValueUsd == null) {
    return {
      recommendedLimitUsd: null,
      declaredValueUsd: null,
      buffers: [],
      totalBufferPercent: 0,
      rationale:
        "No declared value is on file, so a coverage limit cannot be sized — " +
        "limits are derived from declared value. Resolve the declared value " +
        "in the review queue and re-score to get limit guidance.",
      currentEffectiveCoverageUsd: effective,
      currentlyAdequate: null,
      currentGapUsd: profile.coverageGapUsd,
      evidence,
    };
  }

  const buffers = collectBuffers(record);
  const totalBufferPercent = buffers.reduce((sum, buffer) => sum + buffer.percent, 0);
  const recommendedLimitUsd = roundUpToThousand(declaredValueUsd * (1 + totalBufferPercent / 100));

  const bufferText =
    buffers.length > 0
      ? ` plus a ${totalBufferPercent}% buffer (${buffers
          .map((buffer) => `${buffer.percent}% for ${buffer.label}`)
          .join(", ")})`
      : " with no fragility, sensitivity, or escalation premium";

  const rationale =
    `Insure to the full declared value of ${formatUsd(declaredValueUsd)}${bufferText} — ` +
    `${formatUsd(recommendedLimitUsd)}, rounded up to the nearest $1,000. ` +
    coverageSentence(effective, recommendedLimitUsd);

  return {
    recommendedLimitUsd,
    declaredValueUsd,
    buffers,
    totalBufferPercent,
    rationale,
    currentEffectiveCoverageUsd: effective,
    currentlyAdequate: effective == null ? null : effective >= recommendedLimitUsd,
    currentGapUsd: profile.coverageGapUsd,
    evidence,
  };
}

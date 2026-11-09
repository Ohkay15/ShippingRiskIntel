import { z } from "zod";

import { transportModeSchema } from "@/schemas/shipment";

/**
 * The carrier fit matrix contract (spec §4 / roadmap Phase 4): a static,
 * owner-owned table of carriers the recommendation engine matches against.
 *
 * The matrix is DATA, not code — the owner replaces the placeholder seed in
 * `matrix-data.ts` with their own carriers and nothing else changes. Zod
 * validates the table at import, so a malformed owner seed fails loudly
 * instead of quietly degrading recommendations.
 */

/** Cargo categories the fit matrix matches on (derived from the record by `classifyCargo`). */
export const CARGO_CATEGORY_VALUES = [
  "general_dry",
  "hazmat",
  "perishable",
  "high_value_fragile",
] as const;
export const cargoCategorySchema = z.enum(CARGO_CATEGORY_VALUES);
export type CargoCategory = (typeof CARGO_CATEGORY_VALUES)[number];

/** Lane risk tiers, ordered low → high; derived from the profile's matrix cell. */
export const LANE_RISK_TIERS = ["low", "medium", "high"] as const;
export const laneRiskTierSchema = z.enum(LANE_RISK_TIERS);
export type LaneRiskTier = (typeof LANE_RISK_TIERS)[number];

/** Tier ordering index — a carrier accepts lanes at or below its max tier. */
export function laneRiskRank(tier: LaneRiskTier): number {
  return LANE_RISK_TIERS.indexOf(tier);
}

export const carrierFitEntrySchema = z.object({
  /** Stable id — what the Actioned transition stores on the record. */
  id: z.string().min(1),
  name: z.string().min(1),
  /** Modes this carrier runs. A record's mode must be in this list to match. */
  modes: z.array(transportModeSchema).min(1),
  /** Cargo categories this carrier is equipped to move. */
  supportedCargoTypes: z.array(cargoCategorySchema).min(1),
  /** Highest lane-risk tier this carrier accepts (low < medium < high). */
  maxLaneRisk: laneRiskTierSchema,
  /** Hazmat capability detail for the owner's seed (e.g. "HM-licensed drivers"). */
  hazmatCertifications: z.array(z.string().min(1)).default([]),
  /** Contractual liability limit (USD) — substitutes into the record's coverage factor. */
  liabilityLimitUsd: z.number().positive(),
  /**
   * Cargo insurance the carrier offers (USD), if any. Placeholder display
   * data for the owner's seed — NOT substituted into scoring, which uses
   * only the record's own coverage fields plus the liability limit.
   */
  insuranceOfferingUsd: z.number().positive().nullable().default(null),
  /** Carrier safety record, 1 (best) to 5 (worst) — matches the scoring scale. */
  safetyRating: z.number().int().min(1).max(5),
  /** Historical claims rate, 1 (best) to 5 (worst) — matches the scoring scale. */
  claimsRating: z.number().int().min(1).max(5),
  notes: z.string().min(1).optional(),
});
export type CarrierFitEntry = z.infer<typeof carrierFitEntrySchema>;

export const carrierFitMatrixSchema = z.object({
  /** Human provenance label — placeholder seeds must say so. */
  sourceLabel: z.string().min(1),
  carriers: z.array(carrierFitEntrySchema),
});
export type CarrierFitMatrix = z.infer<typeof carrierFitMatrixSchema>;

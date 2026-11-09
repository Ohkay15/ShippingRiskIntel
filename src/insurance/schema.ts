import { z } from "zod";

import { hazardClassSchema, transportModeSchema } from "@/schemas/shipment";
import { cargoCategorySchema, laneRiskTierSchema } from "@/carriers/schema";

/**
 * The insurer fit matrix contract — the insurance counterpart to the
 * carrier fit matrix (`carriers/schema.ts`), matching the same dimensions
 * (cargo category, mode, lane risk) plus hazard-class capability and a
 * per-shipment coverage limit.
 *
 * Cargo categories and lane-risk tiers are shared vocabulary imported from
 * the carrier matrix's schema: one classification of a record must match
 * across every fit matrix, or the same shipment reads differently in the
 * carrier and insurance panels. The matrix is DATA, not code — the owner
 * replaces the placeholder seed in `matrix-data.ts` with their own insurer
 * products and nothing else changes. Zod validates the table at import, so
 * a malformed owner seed fails loudly instead of quietly degrading
 * recommendations.
 */

export const insurerFitEntrySchema = z.object({
  /** Stable id — what the Actioned transition stores on the record. */
  id: z.string().min(1),
  insurerName: z.string().min(1),
  productName: z.string().min(1),
  /** Modes this product covers. A record's mode must be in this list to match. */
  modes: z.array(transportModeSchema).min(1),
  /** Cargo categories this product covers (same registry as the carrier matrix). */
  supportedCargoTypes: z.array(cargoCategorySchema).min(1),
  /**
   * UN hazard classes this product will write, including "none" for non-DG
   * cargo. A record with a known class must be in this list to match; an
   * UNKNOWN class (null) does not disqualify a product — the record is
   * already flagged for review, and the hazard filter resumes the moment
   * the field is filled.
   */
  supportedHazardClasses: z.array(hazardClassSchema).min(1),
  /** Highest lane-risk tier this product accepts (low < medium < high). */
  maxLaneRisk: laneRiskTierSchema,
  /** Maximum per-shipment limit this product can write (USD). */
  coverageLimitUsd: z.number().positive(),
  /** Plain-language liability/deductible terms, for the owner's seed. */
  liabilityTerms: z.string().min(1),
  notes: z.string().min(1).optional(),
});
export type InsurerFitEntry = z.infer<typeof insurerFitEntrySchema>;

export const insurerFitMatrixSchema = z.object({
  /** Human provenance label — placeholder seeds must say so. */
  sourceLabel: z.string().min(1),
  products: z.array(insurerFitEntrySchema),
});
export type InsurerFitMatrix = z.infer<typeof insurerFitMatrixSchema>;

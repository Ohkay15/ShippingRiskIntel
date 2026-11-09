import { z } from "zod";

/**
 * Shared intake contract — the ten risk-factor input fields from the MVP spec
 * (Risk Intel proposal deck). Every later feature (intake form, extraction,
 * scoring, dashboard) builds on these schemas. They are the single source of
 * truth for what a shipment record contains.
 *
 * Fields are nullable, not defaulted: a draft record may be partially filled,
 * and a missing value must surface as "unknown" downstream — never as a
 * silent zero or a guess. Format constraints (enums, regex) still apply when
 * a value IS present.
 */

// ---------------------------------------------------------------------------
// Shared value types
// ---------------------------------------------------------------------------

/** UN number format per the spec's extraction schema: "UN" + 4 digits. */
const UN_NUMBER = z
  .string()
  .regex(/^UN\s?\d{4}$/, "Expected UN number like 'UN1830'");

/** UN hazard classes for dangerous goods. */
export const HAZARD_CLASS_VALUES = [
  "1", // explosives
  "2", // gases
  "3", // flammable liquids
  "4", // flammable solids
  "5.1", // oxidizers
  "5.2", // organic peroxides
  "6.1", // toxic substances
  "6.2", // infectious substances
  "7", // radioactive
  "8", // corrosives
  "9", // miscellaneous
  "none",
] as const;

export const hazardClassSchema = z.enum(HAZARD_CLASS_VALUES);

export const transportModeSchema = z.enum(["road", "rail", "ocean", "air", "intermodal"]);
export type TransportMode = z.infer<typeof transportModeSchema>;

export const loadTypeSchema = z.enum(["sealed_dedicated", "shared"]);
export type LoadType = z.infer<typeof loadTypeSchema>;

export const fragilityClassSchema = z.enum(["low", "medium", "high", "ultra"]);

export const delaySensitivitySchema = z.enum(["perishable", "jit", "flexible"]);

export const escalationExposureSchema = z.enum(["contained", "spreads"]);

/**
 * Live lane conditions are a manual pick in the MVP (no automated feed —
 * spec non-goal). Operator selects every flag that currently applies.
 */
export const liveConditionValues = [
  "severe_weather",
  "port_congestion",
  "labor_disruption",
  "customs_delay",
  "road_closure",
  "none_reported",
] as const;
export const liveConditionsSchema = z.enum(liveConditionValues);

/** ISO 8601 date string (yyyy-mm-dd) — used for certification expiry. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected ISO date (yyyy-mm-dd)");

/** Nullable string that treats empty/whitespace-only input as unknown. */
const optionalText = z
  .string()
  .trim()
  .min(1)
  .transform((s) => s)
  .nullable()
  .optional();

const money = z.number().positive("Monetary amounts must be positive").nullable().optional();

// ---------------------------------------------------------------------------
// The ten factor schemas
// ---------------------------------------------------------------------------

/** 1. Cargo type & hazard class — form / invoice, DG declaration. */
export const cargoHazardSchema = z.object({
  cargoDescription: optionalText,
  hsCode: optionalText,
  unNumber: UN_NUMBER.nullable().optional(),
  hazardClass: hazardClassSchema.nullable().optional(),
});
export type CargoHazard = z.infer<typeof cargoHazardSchema>;

/** 2. Packing & certifications — form / packing list, DG declaration. */
export const packingCertsSchema = z.object({
  packingType: optionalText,
  ispm15CertPresent: z.boolean().nullable().optional(),
  dgCertPresent: z.boolean().nullable().optional(),
  certExpiryDate: isoDate.nullable().optional(),
});
export type PackingCerts = z.infer<typeof packingCertsSchema>;

/** 3. Carrier & shipper record — form (carrier lookup table). */
export const carrierRecordSchema = z.object({
  carrierId: optionalText,
  carrierName: optionalText,
  /** Carrier safety rating, 1 (best) to 5 (worst) — matches scoring scale. */
  carrierSafetyRating: z.number().int().min(1).max(5).nullable().optional(),
  /** Historical claims rate per 100 shipments, 1 (best) to 5 (worst). */
  carrierClaimsRating: z.number().int().min(1).max(5).nullable().optional(),
});
export type CarrierRecord = z.infer<typeof carrierRecordSchema>;

/** 4. Route & lane history — form / BOL. */
export const routeLaneSchema = z.object({
  origin: optionalText,
  destination: optionalText,
  mode: transportModeSchema.nullable().optional(),
  laneId: optionalText,
});
export type RouteLane = z.infer<typeof routeLaneSchema>;

/** 5. Live conditions — manual pick in MVP. */
export const liveConditionsFactorSchema = z.object({
  conditions: z.array(liveConditionsSchema).default([]),
  notes: optionalText,
});
export type LiveConditionsFactor = z.infer<typeof liveConditionsFactorSchema>;

/** 6. Load type — form / BOL: sealed-dedicated vs shared with handling points. */
export const loadTypeFactorSchema = z.object({
  loadType: loadTypeSchema.nullable().optional(),
  /** Number of intermediate handling points on a shared load. */
  handlingPoints: z.number().int().min(0).nullable().optional(),
});
export type LoadTypeFactor = z.infer<typeof loadTypeFactorSchema>;

/** 7. Declared value & fragility — form / invoice. */
export const valueFragilitySchema = z.object({
  declaredValueUsd: money,
  fragilityClass: fragilityClassSchema.nullable().optional(),
});
export type ValueFragility = z.infer<typeof valueFragilitySchema>;

/** 8. Shipment sensitivity — form: perishable / JIT / flexible. */
export const sensitivitySchema = z.object({
  delaySensitivity: delaySensitivitySchema.nullable().optional(),
});
export type Sensitivity = z.infer<typeof sensitivitySchema>;

/** 9. Escalation potential — form / derived from hazard class. */
export const escalationSchema = z.object({
  /** Contained loss vs one that spreads (perishables, hazmat adjacency). */
  escalationExposure: escalationExposureSchema.nullable().optional(),
  /** Operator contact to alert when an exception fires (MVP: free text). */
  escalationContact: optionalText,
});
export type Escalation = z.infer<typeof escalationSchema>;

/** 10. Coverage vs. value — form / invoice terms. */
export const coverageSchema = z.object({
  /** Insurance coverage amount. Unknown when no coverage data is on file. */
  insuranceCoverageUsd: money,
  /** Carrier's contractual liability limit. Unknown when terms not on file. */
  carrierLiabilityLimitUsd: money,
});
export type Coverage = z.infer<typeof coverageSchema>;

// ---------------------------------------------------------------------------
// Composite intake record + factor registry
// ---------------------------------------------------------------------------

export const FACTOR_KEYS = [
  "cargo_hazard",
  "packing_certs",
  "carrier_record",
  "route_lane",
  "live_conditions",
  "load_type",
  "value_fragility",
  "sensitivity",
  "escalation",
  "coverage",
] as const;
export type FactorKey = (typeof FACTOR_KEYS)[number];

/**
 * The full shipment intake record: ten factor groups, every field nullable.
 * Order mirrors the spec's input-field table. Groups default to empty so a
 * draft record can arrive partially filled.
 */
export const shipmentIntakeSchema = z.object({
  cargo_hazard: cargoHazardSchema.default({}),
  packing_certs: packingCertsSchema.default({}),
  carrier_record: carrierRecordSchema.default({}),
  route_lane: routeLaneSchema.default({}),
  live_conditions: liveConditionsFactorSchema.default({}),
  load_type: loadTypeFactorSchema.default({}),
  value_fragility: valueFragilitySchema.default({}),
  sensitivity: sensitivitySchema.default({}),
  escalation: escalationSchema.default({}),
  coverage: coverageSchema.default({}),
});
export type ShipmentIntake = z.infer<typeof shipmentIntakeSchema>;

// ---------------------------------------------------------------------------
// Coverage-gap math (pure)
// ---------------------------------------------------------------------------

/**
 * Dollar gap between declared value and the effective coverage:
 * declared value − min(coverage, carrier liability limit).
 *
 * Returns null when coverage data is absent — callers must render that as
 * "unknown", never $0. A missing-coverage record showing a $0 gap would read
 * as fully covered, the single worst silent failure this product can ship
 * (spec acceptance table).
 */
export function coverageGapUsd(
  valueFragility: Pick<ValueFragility, "declaredValueUsd">,
  coverage: Pick<Coverage, "insuranceCoverageUsd" | "carrierLiabilityLimitUsd">
): number | null {
  const { declaredValueUsd } = valueFragility;
  const effectiveCoverage = effectiveCoverageUsd(coverage);

  if (declaredValueUsd == null || effectiveCoverage == null) {
    return null;
  }

  return roundToCents(declaredValueUsd - effectiveCoverage);
}

/**
 * The coverage actually in force: the smaller of the insurance amount and
 * the carrier liability limit, or whichever of the two is on file. Null
 * when no coverage data exists at all.
 */
export function effectiveCoverageUsd(
  coverage: Pick<Coverage, "insuranceCoverageUsd" | "carrierLiabilityLimitUsd">
): number | null {
  const { insuranceCoverageUsd, carrierLiabilityLimitUsd } = coverage;

  if (insuranceCoverageUsd == null && carrierLiabilityLimitUsd == null) {
    return null;
  }

  if (insuranceCoverageUsd != null && carrierLiabilityLimitUsd != null) {
    return Math.min(insuranceCoverageUsd, carrierLiabilityLimitUsd);
  }

  return (insuranceCoverageUsd ?? carrierLiabilityLimitUsd)!;
}

/** Two-decimal rounding so float artifacts never leak into dollar amounts. */
function roundToCents(usd: number): number {
  return Math.round(usd * 100) / 100;
}

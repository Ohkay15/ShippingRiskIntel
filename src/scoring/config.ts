import { z } from "zod";
import { FACTOR_KEYS } from "../schemas/shipment";
import { conditionSchema, type Condition } from "./conditions";

/**
 * Scoring config: factor weights and per-factor rule sets, validated by Zod.
 *
 * This file is the calibration surface. Weights, thresholds, and rule
 * ratings are DATA — recalibrating the engine (the spec's pilot loop) means
 * editing this config, never the scoring logic in engine.ts.
 *
 * Reading the model: the likelihood axis describes how likely an incident is
 * on this shipment (operational reliability), the consequence axis how severe
 * a single loss would be (cargo value, fragility, containment, coverage).
 * Clean operations + resilient cargo land LL; sloppy operations + severe
 * cargo land HH.
 */

/** Ratings are integers on the 1–5 ISO 31000 scale. */
export type Rating = 1 | 2 | 3 | 4 | 5;

const ratingSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]) satisfies z.ZodType<Rating>;

export interface FactorRule {
  id: string;
  /** Ordered evaluation: the first matching rule rates the factor. */
  when: Condition;
  likelihood: Rating;
  consequence: Rating;
  /** Human-readable rationale rendered next to the rating in the UI. */
  note?: string;
}

export interface FactorRuleSet {
  /**
   * Dotted paths that must be present (non-null) for rules to rate this
   * factor. Any missing path yields the conservative default rating plus a
   * review flag — never a silent guess.
   */
  requiredFields: string[];
  rules: FactorRule[];
}

export const factorRuleSetSchema = z.object({
  requiredFields: z.array(z.string().min(1)).default([]),
  rules: z.array(
    z.object({
      id: z.string().min(1),
      when: conditionSchema,
      likelihood: ratingSchema,
      consequence: ratingSchema,
      note: z.string().min(1).optional(),
    })
  ),
});

export const scoringConfigSchema = z
  .object({
    /** Per-factor weights; must sum to 1.0 across the ten factors. */
    weights: z.object({
      cargo_hazard: z.number().min(0).max(1),
      packing_certs: z.number().min(0).max(1),
      carrier_record: z.number().min(0).max(1),
      route_lane: z.number().min(0).max(1),
      live_conditions: z.number().min(0).max(1),
      load_type: z.number().min(0).max(1),
      value_fragility: z.number().min(0).max(1),
      sensitivity: z.number().min(0).max(1),
      escalation: z.number().min(0).max(1),
      coverage: z.number().min(0).max(1),
    }),
    /**
     * Weighted-average likelihood/consequence strictly above this value
     * counts as the H tier of the risk matrix. 2.5 (scale midpoint) keeps all
     * four quadrants reachable without requiring every factor to agree.
     */
    matrixSplitAt: z.number().min(1).max(5),
    defaults: z.object({
      likelihood: ratingSchema,
      consequence: ratingSchema,
      /** Whether default ratings raise review flags (spec: they do). */
      flaggedForReview: z.boolean(),
    }),
    rules: z.object({
      cargo_hazard: factorRuleSetSchema,
      packing_certs: factorRuleSetSchema,
      carrier_record: factorRuleSetSchema,
      route_lane: factorRuleSetSchema,
      live_conditions: factorRuleSetSchema,
      load_type: factorRuleSetSchema,
      value_fragility: factorRuleSetSchema,
      sensitivity: factorRuleSetSchema,
      escalation: factorRuleSetSchema,
      coverage: factorRuleSetSchema,
    }),
  })
  .refine(
    (config) => Math.abs(FACTOR_KEYS.reduce((sum, key) => sum + config.weights[key], 0) - 1) < 1e-9,
    "Factor weights must sum to 1.0"
  )
  .refine(
    (config) =>
      FACTOR_KEYS.every((key) => {
        const ids = config.rules[key].rules.map((rule) => rule.id);
        return new Set(ids).size === ids.length;
      }),
    "Rule ids must be unique within a factor"
  );

export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

/** UN hazard classes that constitute dangerous goods (anything but "none"). */
const DG_CLASSES = ["1", "2", "3", "4", "5.1", "5.2", "6.1", "6.2", "7", "8", "9"];

/** Acute-incident hazard classes: explosives, gases, flammables, oxidizers, peroxides, toxics, radioactive. */
const HIGH_HAZARD_CLASSES = ["1", "2", "3", "5.1", "5.2", "6.1", "7"];

/**
 * Fixed "as of" date for cert-expiry rules — part of config, never a clock,
 * so scoring stays pure and deterministic. Bump during calibration.
 */
const CERT_AS_OF = "2026-11-09";

/**
 * Default calibration for the intra-US corridor (dry goods + hazmat mix),
 * labeled as a starting hypothesis pending owner input on corridor and cargo
 * mix. Weights follow the MVP spec's example config.
 */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = scoringConfigSchema.parse({
  weights: {
    cargo_hazard: 0.16,
    packing_certs: 0.12,
    carrier_record: 0.12,
    route_lane: 0.1,
    live_conditions: 0.08,
    load_type: 0.08,
    value_fragility: 0.12,
    sensitivity: 0.08,
    escalation: 0.08,
    coverage: 0.06,
  },
  /**
   * Quadrant split for the matrix cell: a rollup above this is the high
   * side. Set at 2 so any regulated cargo, active friction, or elevated
   * consequence lifts a record out of the LL corner — the benign band is
   * 1.0–2.0, not the scale midpoint.
   */
  matrixSplitAt: 2,
  defaults: { likelihood: 3, consequence: 3, flaggedForReview: true },
  rules: {
    cargo_hazard: {
      requiredFields: ["record.cargo_hazard.hazardClass"],
      rules: [
        {
          id: "hazard_high",
          when: { field: "record.cargo_hazard.hazardClass", op: "in", values: HIGH_HAZARD_CLASSES },
          likelihood: 4,
          consequence: 4,
          note: "UN-classified dangerous goods with acute incident potential",
        },
        {
          id: "hazard_moderate",
          when: { field: "record.cargo_hazard.hazardClass", op: "in", values: ["4", "8", "9"] },
          likelihood: 4,
          consequence: 3,
          note: "Regulated dangerous goods, moderate severity",
        },
        {
          id: "hazard_none",
          when: { field: "record.cargo_hazard.hazardClass", op: "eq", value: "none" },
          likelihood: 2,
          consequence: 2,
          note: "Non-dangerous general cargo",
        },
      ],
    },
    packing_certs: {
      requiredFields: [],
      rules: [
        {
          id: "dg_cert_missing",
          when: {
            and: [
              { field: "record.packing_certs.dgCertPresent", op: "eq", value: false },
              { field: "record.cargo_hazard.hazardClass", op: "in", values: DG_CLASSES },
            ],
          },
          likelihood: 5,
          consequence: 4,
          note: "Dangerous goods moving with no DG cert on file",
        },
        {
          id: "cert_expired",
          when: {
            field: "record.packing_certs.certExpiryDate",
            op: "lt",
            value: CERT_AS_OF,
          },
          likelihood: 4,
          consequence: 3,
          note: "Certification past its expiry date",
        },
        {
          id: "ispm_missing",
          when: { field: "record.packing_certs.ispm15CertPresent", op: "eq", value: false },
          likelihood: 3,
          consequence: 2,
          note: "No ISPM-15 certification for wood packaging",
        },
        {
          id: "certs_complete",
          when: {
            and: [
              { field: "record.packing_certs.ispm15CertPresent", op: "eq", value: true },
              {
                or: [
                  { field: "record.packing_certs.dgCertPresent", op: "eq", value: true },
                  { field: "record.cargo_hazard.hazardClass", op: "eq", value: "none" },
                ],
              },
            ],
          },
          likelihood: 1,
          consequence: 1,
          note: "Certifications complete for this cargo",
        },
        {
          id: "dg_cert_not_applicable",
          when: {
            and: [
              { field: "record.cargo_hazard.hazardClass", op: "eq", value: "none" },
              { field: "record.packing_certs.dgCertPresent", op: "exists", value: false },
            ],
          },
          likelihood: 2,
          consequence: 1,
          note: "DG cert not recorded for non-dangerous cargo (benign)",
        },
      ],
    },
    carrier_record: {
      requiredFields: [
        "record.carrier_record.carrierSafetyRating",
        "record.carrier_record.carrierClaimsRating",
      ],
      rules: [
        {
          id: "carrier_worst",
          when: {
            or: [
              { field: "record.carrier_record.carrierSafetyRating", op: "gte", value: 5 },
              { field: "record.carrier_record.carrierClaimsRating", op: "gte", value: 5 },
            ],
          },
          likelihood: 5,
          consequence: 4,
          note: "Carrier at the bottom of the safety/claims scale",
        },
        {
          id: "carrier_poor",
          when: {
            or: [
              { field: "record.carrier_record.carrierSafetyRating", op: "gte", value: 4 },
              { field: "record.carrier_record.carrierClaimsRating", op: "gte", value: 4 },
            ],
          },
          likelihood: 4,
          consequence: 3,
          note: "Below-average carrier safety or claims history",
        },
        {
          id: "carrier_strong",
          when: {
            and: [
              { field: "record.carrier_record.carrierSafetyRating", op: "lte", value: 2 },
              { field: "record.carrier_record.carrierClaimsRating", op: "lte", value: 2 },
            ],
          },
          likelihood: 1,
          consequence: 2,
          note: "Strong carrier safety and claims record",
        },
        {
          id: "carrier_average",
          when: {
            and: [
              { field: "record.carrier_record.carrierSafetyRating", op: "lte", value: 3 },
              { field: "record.carrier_record.carrierClaimsRating", op: "lte", value: 3 },
            ],
          },
          likelihood: 2,
          consequence: 2,
          note: "Average carrier record",
        },
      ],
    },
    route_lane: {
      requiredFields: ["record.route_lane.mode"],
      rules: [
        {
          id: "route_multileg",
          when: {
            field: "record.route_lane.mode",
            op: "in",
            values: ["ocean", "intermodal"],
          },
          likelihood: 3,
          consequence: 2,
          note: "Multi-leg mode adds transfer and handling exposure",
        },
        {
          id: "route_rail",
          when: { field: "record.route_lane.mode", op: "eq", value: "rail" },
          likelihood: 2,
          consequence: 2,
          note: "Rail drayage on fixed infrastructure",
        },
        {
          id: "route_road",
          when: { field: "record.route_lane.mode", op: "eq", value: "road" },
          likelihood: 2,
          consequence: 2,
          note: "Single-mode road drayage (intra-US baseline)",
        },
        {
          id: "route_air",
          when: { field: "record.route_lane.mode", op: "eq", value: "air" },
          likelihood: 1,
          consequence: 2,
          note: "Air freight, controlled handling environment",
        },
      ],
    },
    live_conditions: {
      requiredFields: [],
      rules: [
        {
          id: "live_severe_weather",
          when: {
            field: "record.live_conditions.conditions",
            op: "contains",
            value: "severe_weather",
          },
          likelihood: 4,
          consequence: 3,
          note: "Severe weather active on the lane",
        },
        {
          id: "live_multiple_disruptions",
          when: { field: "derived.activeDisruptionCount", op: "gte", value: 2 },
          likelihood: 4,
          consequence: 2,
          note: "Multiple simultaneous lane disruptions",
        },
        {
          id: "live_disruption",
          when: { field: "derived.activeDisruptionCount", op: "gte", value: 1 },
          likelihood: 3,
          consequence: 2,
          note: "Active lane disruption",
        },
        {
          id: "live_clear",
          // An explicit "none_reported" pick — not an empty array. An untouched
          // draft must fall through to the flagged default, never read as clear.
          when: {
            field: "record.live_conditions.conditions",
            op: "contains",
            value: "none_reported",
          },
          likelihood: 1,
          consequence: 1,
          note: "No disruptions reported on the lane",
        },
      ],
    },
    load_type: {
      requiredFields: ["record.load_type.loadType"],
      rules: [
        {
          id: "load_shared_many_handoffs",
          when: {
            and: [
              { field: "record.load_type.loadType", op: "eq", value: "shared" },
              { field: "record.load_type.handlingPoints", op: "gte", value: 3 },
            ],
          },
          likelihood: 4,
          consequence: 3,
          note: "Shared load with many handling points",
        },
        {
          id: "load_shared",
          when: { field: "record.load_type.loadType", op: "eq", value: "shared" },
          likelihood: 3,
          consequence: 2,
          note: "Shared load with intermediate handling",
        },
        {
          id: "load_sealed_dedicated",
          when: { field: "record.load_type.loadType", op: "eq", value: "sealed_dedicated" },
          likelihood: 1,
          consequence: 2,
          note: "Sealed dedicated load, no intermediate handling",
        },
      ],
    },
    value_fragility: {
      requiredFields: [
        "record.value_fragility.declaredValueUsd",
        "record.value_fragility.fragilityClass",
      ],
      rules: [
        {
          id: "value_high_and_fragile",
          when: {
            and: [
              { field: "record.value_fragility.declaredValueUsd", op: "gte", value: 100000 },
              {
                field: "record.value_fragility.fragilityClass",
                op: "in",
                values: ["high", "ultra"],
              },
            ],
          },
          likelihood: 2,
          consequence: 5,
          note: "High-value fragile cargo — a single loss is severe",
        },
        {
          id: "value_ultra_fragile",
          when: { field: "record.value_fragility.fragilityClass", op: "eq", value: "ultra" },
          likelihood: 2,
          consequence: 5,
          note: "Ultra-fragile cargo",
        },
        {
          id: "value_high_fragility",
          when: { field: "record.value_fragility.fragilityClass", op: "eq", value: "high" },
          likelihood: 2,
          consequence: 4,
          note: "Fragile cargo",
        },
        {
          id: "value_high_value",
          when: { field: "record.value_fragility.declaredValueUsd", op: "gte", value: 100000 },
          likelihood: 2,
          consequence: 3,
          note: "High declared value",
        },
        {
          id: "value_standard",
          when: {
            and: [
              { field: "record.value_fragility.declaredValueUsd", op: "lt", value: 100000 },
              {
                field: "record.value_fragility.fragilityClass",
                op: "in",
                values: ["low", "medium"],
              },
            ],
          },
          likelihood: 2,
          consequence: 1,
          note: "Standard value, durable cargo",
        },
      ],
    },
    sensitivity: {
      requiredFields: ["record.sensitivity.delaySensitivity"],
      rules: [
        {
          id: "sensitivity_perishable",
          when: { field: "record.sensitivity.delaySensitivity", op: "eq", value: "perishable" },
          likelihood: 3,
          consequence: 4,
          note: "Perishable — delay converts directly to loss",
        },
        {
          id: "sensitivity_jit",
          when: { field: "record.sensitivity.delaySensitivity", op: "eq", value: "jit" },
          likelihood: 3,
          consequence: 2,
          note: "Just-in-time delivery commitment",
        },
        {
          id: "sensitivity_flexible",
          when: { field: "record.sensitivity.delaySensitivity", op: "eq", value: "flexible" },
          likelihood: 1,
          consequence: 1,
          note: "Flexible delivery window",
        },
      ],
    },
    escalation: {
      requiredFields: ["record.escalation.escalationExposure"],
      rules: [
        {
          id: "escalation_spreads",
          when: { field: "record.escalation.escalationExposure", op: "eq", value: "spreads" },
          likelihood: 2,
          consequence: 5,
          note: "Loss spreads beyond the initial incident (perishables, hazmat adjacency)",
        },
        {
          id: "escalation_contained",
          when: { field: "record.escalation.escalationExposure", op: "eq", value: "contained" },
          likelihood: 2,
          consequence: 1,
          note: "Loss contained to this shipment",
        },
      ],
    },
    coverage: {
      requiredFields: [
        "record.value_fragility.declaredValueUsd",
        "record.coverage.insuranceCoverageUsd",
        "record.coverage.carrierLiabilityLimitUsd",
      ],
      rules: [
        {
          id: "coverage_severely_under",
          when: { field: "derived.coverageGapRatio", op: "gte", value: 0.5 },
          likelihood: 3,
          consequence: 5,
          note: "Coverage leaves more than half the declared value exposed",
        },
        {
          id: "coverage_under",
          when: { field: "derived.coverageGapUsd", op: "gt", value: 0 },
          likelihood: 2,
          consequence: 4,
          note: "Coverage below declared value",
        },
        {
          id: "coverage_full",
          when: { field: "derived.coverageGapUsd", op: "lte", value: 0 },
          likelihood: 1,
          consequence: 1,
          note: "Coverage meets or exceeds declared value",
        },
      ],
    },
  },
});

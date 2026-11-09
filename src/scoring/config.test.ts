import { describe, expect, it } from "vitest";
import { FACTOR_KEYS } from "../schemas/shipment";
import { DEFAULT_SCORING_CONFIG, scoringConfigSchema, type ScoringConfig } from "./config";

describe("DEFAULT_SCORING_CONFIG", () => {
  it("carries exactly ten weights summing to 1.0", () => {
    const weights = Object.values(DEFAULT_SCORING_CONFIG.weights);
    expect(weights).toHaveLength(10);
    expect(weights.reduce((total, weight) => total + weight, 0)).toBeCloseTo(1, 9);
  });

  it("gives every factor at least one rule", () => {
    for (const factor of FACTOR_KEYS) {
      expect(DEFAULT_SCORING_CONFIG.rules[factor].rules.length).toBeGreaterThan(0);
    }
  });

  it("round-trips through its own schema", () => {
    expect(scoringConfigSchema.safeParse(DEFAULT_SCORING_CONFIG).success).toBe(true);
  });
});

describe("scoringConfigSchema", () => {
  it("rejects weights that do not sum to 1.0", () => {
    const bad = structuredClone(DEFAULT_SCORING_CONFIG);
    bad.weights.cargo_hazard = 0.5;
    expect(scoringConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a missing factor weight", () => {
    const bad = structuredClone(DEFAULT_SCORING_CONFIG);
    delete (bad.weights as Partial<ScoringConfig["weights"]>).coverage;
    expect(scoringConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects out-of-scale ratings", () => {
    const bad = structuredClone(DEFAULT_SCORING_CONFIG);
    bad.rules.cargo_hazard.rules[0].likelihood = 6 as never;
    expect(scoringConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects duplicate rule ids within a factor", () => {
    const bad = structuredClone(DEFAULT_SCORING_CONFIG);
    bad.rules.cargo_hazard.rules[1].id = bad.rules.cargo_hazard.rules[0].id;
    expect(scoringConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a missing rule set", () => {
    const bad = structuredClone(DEFAULT_SCORING_CONFIG);
    delete (bad.rules as Partial<ScoringConfig["rules"]>).coverage;
    expect(scoringConfigSchema.safeParse(bad).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  FACTOR_KEYS,
  shipmentIntakeSchema,
  type ShipmentIntake,
} from "../schemas/shipment";
import { DEFAULT_SCORING_CONFIG, type ScoringConfig } from "./config";
import { score } from "./engine";

/**
 * Local record builders (mirroring the scaffold's schema-test fixtures so the
 * schema tests stay untouched): a clean, fully covered dry-goods record that
 * every test reshapes at group level.
 */
function rawRecord(overrides: Partial<ShipmentIntake> = {}): Partial<ShipmentIntake> {
  return {
    cargo_hazard: {
      cargoDescription: "Boxed consumer electronics",
      hsCode: "8471.30",
      unNumber: null,
      hazardClass: "none",
    },
    packing_certs: {
      packingType: "Double-wall corrugated cartons, palletized",
      ispm15CertPresent: true,
      dgCertPresent: false,
      certExpiryDate: null,
    },
    carrier_record: {
      carrierId: "car-001",
      carrierName: "Midwest Freight Lines",
      carrierSafetyRating: 2,
      carrierClaimsRating: 2,
    },
    route_lane: {
      origin: "Chicago, IL",
      destination: "Dallas, TX",
      mode: "road",
      laneId: "US-IL-TX-01",
    },
    live_conditions: { conditions: ["none_reported"], notes: null },
    load_type: { loadType: "sealed_dedicated", handlingPoints: 0 },
    value_fragility: { declaredValueUsd: 120000, fragilityClass: "medium" },
    sensitivity: { delaySensitivity: "jit" },
    escalation: { escalationExposure: "contained", escalationContact: "ops@example.com" },
    coverage: {
      insuranceCoverageUsd: 150000,
      carrierLiabilityLimitUsd: 100000,
    },
    ...overrides,
  };
}

function cleanRecord(overrides: Partial<ShipmentIntake> = {}): ShipmentIntake {
  return shipmentIntakeSchema.parse(rawRecord(overrides));
}

/** Triple-hazard record: class-3 flammables, no DG cert, worst-rated carrier. */
function hazardRecord(overrides: Partial<ShipmentIntake> = {}): ShipmentIntake {
  return cleanRecord({
    cargo_hazard: {
      cargoDescription: "Acetone drums",
      hsCode: "2914.11",
      unNumber: "UN1090",
      hazardClass: "3",
    },
    packing_certs: {
      packingType: "Steel drums",
      ispm15CertPresent: true,
      dgCertPresent: false,
      certExpiryDate: null,
    },
    carrier_record: {
      carrierId: "car-666",
      carrierName: "Redline Overnight",
      carrierSafetyRating: 5,
      carrierClaimsRating: 5,
    },
    ...overrides,
  });
}

/** Renormalize weights so custom configs still satisfy the sum-to-1 refinement. */
function renormalizedWeights(weights: ShipmentConfigWeights): ShipmentConfigWeights {
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  return Object.fromEntries(
    Object.entries(weights).map(([factor, weight]) => [factor, weight / total])
  ) as ShipmentConfigWeights;
}
type ShipmentConfigWeights = ScoringConfig["weights"];

describe("score — determinism", () => {
  it("produces an identical profile when the same record is scored twice", () => {
    const record = cleanRecord();
    expect(score(record)).toEqual(score(record));
    expect(JSON.stringify(score(record))).toBe(JSON.stringify(score(record)));
  });

  it("produces an identical profile for a hazard record with custom config", () => {
    const record = hazardRecord();
    const config: ScoringConfig = {
      ...DEFAULT_SCORING_CONFIG,
      matrixSplitAt: 3,
      weights: renormalizedWeights({ ...DEFAULT_SCORING_CONFIG.weights, cargo_hazard: 0.5 }),
    };
    expect(score(record, config)).toEqual(score(record, config));
  });

  it("does not mutate the record it scores", () => {
    const record = cleanRecord();
    const snapshot = structuredClone(record);
    score(record);
    expect(record).toEqual(snapshot);
  });
});

describe("score — factor coverage and explainability", () => {
  it("rates all ten factors in spec order, each with a basis and its config weight", () => {
    const profile = score(cleanRecord());
    expect(profile.ratings.map((rating) => rating.factor)).toEqual([...FACTOR_KEYS]);
    for (const rating of profile.ratings) {
      expect(["rule", "llm", "review", "default"]).toContain(rating.basis.source);
      expect(rating.weight).toBe(DEFAULT_SCORING_CONFIG.weights[rating.factor]);
      expect(rating.likelihood).toBeGreaterThanOrEqual(1);
      expect(rating.likelihood).toBeLessThanOrEqual(5);
      expect(rating.consequence).toBeGreaterThanOrEqual(1);
      expect(rating.consequence).toBeLessThanOrEqual(5);
    }
  });

  it("records which rule fired — including its note — as the rating basis", () => {
    const profile = score(hazardRecord());
    const cargo = profile.ratings.find((rating) => rating.factor === "cargo_hazard");
    expect(cargo?.basis).toEqual({
      source: "rule",
      ruleId: "hazard_high",
      note: "UN-classified dangerous goods with acute incident potential",
    });
  });

  it("evaluates rules in order — a missing DG cert outranks an expired one", () => {
    const profile = score(
      hazardRecord({
        packing_certs: {
          packingType: "Steel drums",
          ispm15CertPresent: true,
          dgCertPresent: false,
          certExpiryDate: "2025-06-30",
        },
      })
    );
    const packing = profile.ratings.find((rating) => rating.factor === "packing_certs");
    expect(packing?.basis).toMatchObject({ source: "rule", ruleId: "dg_cert_missing" });
  });

  it("keeps the composite within the 1-25 scale for clean and empty records", () => {
    for (const record of [cleanRecord(), hazardRecord(), shipmentIntakeSchema.parse({})]) {
      const profile = score(record);
      expect(profile.score).toBeGreaterThanOrEqual(1);
      expect(profile.score).toBeLessThanOrEqual(25);
    }
  });
});

describe("score — missing data (conservative defaults and review flags)", () => {
  it("rates every factor from the conservative default when the record is empty", () => {
    const profile = score(shipmentIntakeSchema.parse({}));
    expect(profile.ratings.every((rating) => rating.basis.source === "default")).toBe(true);
    for (const rating of profile.ratings) {
      expect(rating.likelihood).toBe(3);
      expect(rating.consequence).toBe(3);
    }
    expect(profile.score).toBe(9); // 3 x 3 across weights summing to 1.0
    expect(profile.needsReview).toBe(true);
    expect(profile.reviewFlags).toHaveLength(10);
  });

  it("flags exactly the factor whose required data is missing, and rule-rates the rest", () => {
    const profile = score(
      cleanRecord({
        cargo_hazard: { cargoDescription: "Mystery crates", hsCode: null, unNumber: null, hazardClass: null },
        // DG cert on file so packing stays rule-rated — isolates the flag to cargo_hazard.
        packing_certs: {
          packingType: "Double-wall corrugated cartons, palletized",
          ispm15CertPresent: true,
          dgCertPresent: true,
          certExpiryDate: null,
        },
      })
    );
    expect(profile.reviewFlags.map((flag) => flag.factor)).toEqual(["cargo_hazard"]);
    expect(profile.reviewFlags[0].reason).toContain("record.cargo_hazard.hazardClass");
    const packing = profile.ratings.find((rating) => rating.factor === "packing_certs");
    expect(packing?.basis.source).toBe("rule");
    expect(profile.needsReview).toBe(true);
  });

  it("defaults the coverage factor when coverage data is absent, never crashing", () => {
    const profile = score(
      cleanRecord({ coverage: { insuranceCoverageUsd: null, carrierLiabilityLimitUsd: null } })
    );
    const coverage = profile.ratings.find((rating) => rating.factor === "coverage");
    expect(coverage?.basis).toMatchObject({ source: "default" });
    expect(profile.needsReview).toBe(true);
  });
});

describe("score — coverage gap", () => {
  it("gaps declared value minus the lower of coverage and carrier liability", () => {
    const profile = score(
      cleanRecord({
        value_fragility: { declaredValueUsd: 100000, fragilityClass: "low" },
        coverage: { insuranceCoverageUsd: 60000, carrierLiabilityLimitUsd: 80000 },
      })
    );
    expect(profile.coverageGapUsd).toBe(40000);
  });

  it("is null — never $0 — when coverage data is absent", () => {
    const profile = score(
      cleanRecord({ coverage: { insuranceCoverageUsd: null, carrierLiabilityLimitUsd: null } })
    );
    expect(profile.coverageGapUsd).toBeNull();
    expect(profile.coverageGapUsd).not.toBe(0);
  });

  it("distinguishes a true zero gap from an unknown gap", () => {
    const fullyCovered = score(
      cleanRecord({
        value_fragility: { declaredValueUsd: 100000, fragilityClass: "low" },
        coverage: { insuranceCoverageUsd: 100000, carrierLiabilityLimitUsd: 100000 },
      })
    );
    const unknown = score(
      cleanRecord({
        value_fragility: { declaredValueUsd: 100000, fragilityClass: "low" },
        coverage: { insuranceCoverageUsd: null, carrierLiabilityLimitUsd: null },
      })
    );
    expect(fullyCovered.coverageGapUsd).toBe(0);
    expect(unknown.coverageGapUsd).toBeNull();
  });
});

describe("score — matrix cell", () => {
  it("places a clean, fully covered dry-goods shipment in the LL corner", () => {
    const profile = score(
      cleanRecord({
        carrier_record: {
          carrierId: "car-001",
          carrierName: "Heartland Freight Lines",
          carrierSafetyRating: 1,
          carrierClaimsRating: 1,
        },
        value_fragility: { declaredValueUsd: 95000, fragilityClass: "low" },
        sensitivity: { delaySensitivity: "flexible" },
        coverage: { insuranceCoverageUsd: 150000, carrierLiabilityLimitUsd: 150000 },
      })
    );
    expect(profile.cell).toBe("LL");
    expect(profile.likelihoodIndex).toBeLessThan(2);
    expect(profile.consequenceIndex).toBeLessThanOrEqual(2);
  });

  it("places a hazard-heavy shipment in the HH corner", () => {
    const profile = score(
      hazardRecord({
        live_conditions: { conditions: ["severe_weather"], notes: null },
        load_type: { loadType: "shared", handlingPoints: 4 },
        value_fragility: { declaredValueUsd: 180000, fragilityClass: "high" },
        escalation: { escalationExposure: "spreads", escalationContact: null },
        coverage: { insuranceCoverageUsd: 60000, carrierLiabilityLimitUsd: 60000 },
      })
    );
    expect(profile.cell).toBe("HH");
    expect(profile.likelihoodIndex).toBeGreaterThan(3);
    expect(profile.consequenceIndex).toBeGreaterThan(3);
  });

  it("moves both axes with the configured split", () => {
    const record = cleanRecord();
    expect(score(record, { ...DEFAULT_SCORING_CONFIG, matrixSplitAt: 5 }).cell).toBe("LL");
    expect(score(record, { ...DEFAULT_SCORING_CONFIG, matrixSplitAt: 1 }).cell).toBe("HH");
  });
});

describe("score — calibration is config, not code", () => {
  it("moves the composite when weights change, without touching the engine", () => {
    const record = hazardRecord();
    const defaultProfile = score(record);
    const cargoHeavy: ScoringConfig = {
      ...DEFAULT_SCORING_CONFIG,
      weights: renormalizedWeights({ ...DEFAULT_SCORING_CONFIG.weights, cargo_hazard: 0.5 }),
    };
    const cargoHeavyProfile = score(record, cargoHeavy);
    expect(cargoHeavyProfile.score).toBeGreaterThan(defaultProfile.score);
    // Renormalization shrinks every weight; the cargo share rises from 0.16 to ~0.37.
    expect(cargoHeavyProfile.ratings.find((rating) => rating.factor === "cargo_hazard")?.weight).toBeGreaterThan(0.35);
  });
});

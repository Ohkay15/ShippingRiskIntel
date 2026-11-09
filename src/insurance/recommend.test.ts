import { describe, expect, it } from "vitest";

import type { InsurerFitEntry, InsurerFitMatrix } from "@/insurance/schema";
import { shipmentIntakeSchema } from "@/schemas/shipment";
import { score } from "@/scoring/engine";

import { insuranceMatches, recommendInsurance, substituteInsurance } from "./recommend";

function record(overrides: Record<string, unknown> = {}) {
  return shipmentIntakeSchema.parse({
    cargo_hazard: { cargoDescription: "Boxed dry goods", hazardClass: "none" },
    route_lane: { origin: "Chicago, IL", destination: "Columbus, OH", mode: "road" },
    value_fragility: { declaredValueUsd: 100000, fragilityClass: "low" },
    sensitivity: { delaySensitivity: "flexible" },
    escalation: { escalationExposure: "contained" },
    coverage: { insuranceCoverageUsd: 20000, carrierLiabilityLimitUsd: 200000 },
    ...overrides,
  });
}

function product(overrides: Partial<InsurerFitEntry>): InsurerFitEntry {
  return {
    id: "test-product",
    insurerName: "Test Mutual",
    productName: "Cargo Standard",
    modes: ["road"],
    supportedCargoTypes: ["general_dry"],
    supportedHazardClasses: ["none"],
    maxLaneRisk: "high",
    coverageLimitUsd: 150000,
    liabilityTerms: "All-risk",
    ...overrides,
  };
}

const MATRIX: InsurerFitMatrix = {
  sourceLabel: "test matrix",
  products: [
    product({
      id: "broad",
      insurerName: "Broad Mutual",
      productName: "Cargo Broad",
      modes: ["road", "rail", "ocean"],
      supportedCargoTypes: ["general_dry", "hazmat", "perishable", "high_value_fragile"],
      supportedHazardClasses: ["none", "1", "2", "3", "7", "8", "9"],
      coverageLimitUsd: 150000,
    }),
    product({
      id: "dry-only",
      insurerName: "Dry Goods Co-op",
      productName: "Dry Transit",
      modes: ["road"],
      supportedCargoTypes: ["general_dry"],
      supportedHazardClasses: ["none"],
      coverageLimitUsd: 150000,
    }),
    product({
      id: "capped",
      insurerName: "Capped Coverage Ltd",
      productName: "Cargo Saver",
      modes: ["road"],
      supportedCargoTypes: ["general_dry"],
      supportedHazardClasses: ["none"],
      coverageLimitUsd: 60000,
    }),
  ],
};

describe("insuranceMatches", () => {
  it("matches a plain dry-goods road record against all three test products", () => {
    const intake = record();
    const profile = score(intake);
    for (const entry of MATRIX.products) {
      expect(insuranceMatches(intake, profile, entry)).toBe(true);
    }
  });

  it("excludes products that do not support the record's cargo category", () => {
    const intake = record({
      cargo_hazard: { cargoDescription: "Corrosive drums", hazardClass: "8" },
    });
    const profile = score(intake);
    expect(insuranceMatches(intake, profile, MATRIX.products[1])).toBe(false); // dry-only
    expect(insuranceMatches(intake, profile, MATRIX.products[0])).toBe(true); // broad
  });

  it("excludes products that do not write the record's hazard class", () => {
    const intake = record({
      cargo_hazard: { cargoDescription: "Explosives", hazardClass: "1" },
    });
    const profile = score(intake);
    // broad is the only product listing class 1 — and it supports hazmat cargo
    expect(insuranceMatches(intake, profile, MATRIX.products[0])).toBe(true);
    expect(insuranceMatches(intake, profile, MATRIX.products[1])).toBe(false);
  });

  it("does not disqualify a product while the hazard class is unknown", () => {
    const intake = record({
      cargo_hazard: { cargoDescription: "Unmarked drums", hazardClass: null },
    });
    const profile = score(intake);
    // Cannot assess DG appetite — the record is review-flagged, not the product.
    expect(insuranceMatches(intake, profile, MATRIX.products[1])).toBe(true);
  });

  it("excludes products that do not run the record's mode", () => {
    const intake = record({ route_lane: { mode: "ocean" } });
    const profile = score(intake);
    expect(insuranceMatches(intake, profile, MATRIX.products[0])).toBe(true); // road+ocean
    expect(insuranceMatches(intake, profile, MATRIX.products[1])).toBe(false); // road only
  });

  it("excludes products that will not write high-risk lanes", () => {
    // HH-cell record: DG cargo, bad carrier, shared load, no coverage.
    const intake = record({
      cargo_hazard: { cargoDescription: "Flammable solvent", hazardClass: "3" },
      carrier_record: { carrierName: "Rough Ride", carrierSafetyRating: 5, carrierClaimsRating: 5 },
      load_type: { loadType: "shared", handlingPoints: 4 },
      sensitivity: { delaySensitivity: "perishable" },
      escalation: { escalationExposure: "spreads" },
    });
    const profile = score(intake);
    expect(profile.cell).toBe("HH");
    const lowLaneProduct = product({ id: "low-lane", maxLaneRisk: "low" });
    expect(insuranceMatches(intake, profile, lowLaneProduct)).toBe(false);
  });
});

describe("recommendInsurance", () => {
  it("computes the projected gap with the real gap math and concrete deltas", () => {
    const intake = record(); // declared 100,000; eff coverage min(20k, 200k) = 20k; gap 80,000
    const profile = score(intake);

    const recs = recommendInsurance(intake, profile, MATRIX, 100000);
    expect(recs).toHaveLength(3);

    // broad: applied coverage min(150k limit, 100k recommended) = 100k →
    // eff = min(100k, liability 200k) = 100k → gap 0, delta −80,000
    const broad = recs.find((rec) => rec.product.id === "broad");
    expect(broad?.projectedGapUsd).toBe(0);
    expect(broad?.gapDeltaUsd).toBe(-80000);
    expect(broad?.limitFit.kind).toBe("covers_recommended");
    expect(broad?.providedCoverageUsd).toBe(100000);

    // capped: applied = 60k product limit → eff = 60k → gap 40,000, delta −40,000
    const capped = recs.find((rec) => rec.product.id === "capped");
    expect(capped?.projectedGapUsd).toBe(40000);
    expect(capped?.gapDeltaUsd).toBe(-40000);
    expect(capped?.limitFit).toEqual({
      kind: "capped_by_product_limit",
      productLimitUsd: 60000,
      appliedCoverageUsd: 60000,
      shortfallUsd: 40000,
    });
  });

  it("caps the provided coverage at the recommended limit — never oversells", () => {
    const intake = record();
    const profile = score(intake);
    const recs = recommendInsurance(intake, profile, MATRIX, 50000);
    const broad = recs.find((rec) => rec.product.id === "broad");
    expect(broad?.providedCoverageUsd).toBe(50000);
    expect(broad?.projectedGapUsd).toBe(50000);
  });

  it("ranks by lowest projected gap, then product id — deterministically", () => {
    const intake = record();
    const profile = score(intake);
    const recs = recommendInsurance(intake, profile, MATRIX, 100000);
    // broad and dry-only both project gap 0; "broad" < "dry-only" < gap 40k "capped"
    expect(recs.map((rec) => rec.product.id)).toEqual(["broad", "dry-only", "capped"]);
    expect(recommendInsurance(intake, profile, MATRIX, 100000)).toEqual(recs);
  });

  it("reports no limit guidance and no gap delta when declared value is unknown", () => {
    const intake = record({ value_fragility: { fragilityClass: "low" } });
    const profile = score(intake);
    const recs = recommendInsurance(intake, profile, MATRIX, null);
    for (const rec of recs) {
      expect(rec.limitFit.kind).toBe("no_limit_guidance");
      expect(rec.gapDeltaUsd).toBeNull(); // current gap is unknown — no delta can be claimed
    }
    const broad = recs.find((rec) => rec.product.id === "broad");
    expect(broad?.projectedGapUsd).toBeNull();
    expect(broad?.providedCoverageUsd).toBe(150000); // product's full limit, uncapped
  });

  it("reports no gap delta when the record has no coverage data at all", () => {
    const intake = record({ coverage: {} });
    const profile = score(intake);
    const recs = recommendInsurance(intake, profile, MATRIX, 100000);
    const broad = recs.find((rec) => rec.product.id === "broad");
    // Current gap unknown → delta unknown; projected gap IS computable once the product is taken.
    expect(broad?.projectedGapUsd).toBe(0);
    expect(broad?.gapDeltaUsd).toBeNull();
  });

  it("substitutes only the insurance amount — carrier liability is untouched", () => {
    const intake = record();
    const broad = MATRIX.products[0];
    const substituted = substituteInsurance(intake, broad, 100000);
    expect(substituted.coverage.insuranceCoverageUsd).toBe(100000);
    expect(substituted.coverage.carrierLiabilityLimitUsd).toBe(200000);
    expect(substituted.carrier_record).toEqual(intake.carrier_record);
  });
});

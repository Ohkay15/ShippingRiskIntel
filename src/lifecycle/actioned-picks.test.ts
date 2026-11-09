import { describe, expect, it } from "vitest";

import type { CarrierFitMatrix } from "@/carriers/schema";
import type { InsurerFitMatrix } from "@/insurance/schema";
import { shipmentIntakeSchema } from "@/schemas/shipment";
import { score } from "@/scoring/engine";

import { buildActionedProjection, buildActionedProjectionFromPicks } from "./actioned-projection";

function record(overrides: Record<string, unknown> = {}) {
  return shipmentIntakeSchema.parse({
    cargo_hazard: { cargoDescription: "Boxed dry goods", hazardClass: "none" },
    packing_certs: { packingType: "cartons", ispm15CertPresent: true, dgCertPresent: true },
    carrier_record: {
      carrierId: "car-bad",
      carrierName: "Rough Ride Freight",
      carrierSafetyRating: 5,
      carrierClaimsRating: 5,
    },
    route_lane: { origin: "Chicago, IL", destination: "Columbus, OH", mode: "road" },
    live_conditions: { conditions: ["none_reported"] },
    load_type: { loadType: "sealed_dedicated", handlingPoints: 0 },
    value_fragility: { declaredValueUsd: 100000, fragilityClass: "low" },
    sensitivity: { delaySensitivity: "flexible" },
    escalation: { escalationExposure: "contained" },
    coverage: { insuranceCoverageUsd: 20000, carrierLiabilityLimitUsd: 200000 },
    ...overrides,
  });
}

const CARRIER_MATRIX: CarrierFitMatrix = {
  sourceLabel: "test matrix",
  carriers: [
    {
      id: "good",
      name: "Good Carrier",
      modes: ["road"],
      supportedCargoTypes: ["general_dry"],
      maxLaneRisk: "high",
      hazmatCertifications: [],
      insuranceOfferingUsd: null,
      liabilityLimitUsd: 200000,
      safetyRating: 1,
      claimsRating: 1,
    },
  ],
};

const INSURER_MATRIX: InsurerFitMatrix = {
  sourceLabel: "test matrix",
  products: [
    {
      id: "broad",
      insurerName: "Broad Mutual",
      productName: "Cargo Broad",
      modes: ["road", "rail"],
      supportedCargoTypes: ["general_dry", "hazmat", "perishable", "high_value_fragile"],
      supportedHazardClasses: ["none", "1", "2", "3", "8", "9"],
      maxLaneRisk: "high",
      coverageLimitUsd: 150000,
      liabilityTerms: "All-risk",
    },
  ],
};

describe("buildActionedProjectionFromPicks", () => {
  it("completes the transition with an insurance pick alone and projects a lower gap", () => {
    const intake = record(); // current gap: 100,000 − min(20k, 200k) = 80,000
    const profile = score(intake);
    const outcome = buildActionedProjectionFromPicks(
      intake,
      profile,
      { insuranceProductId: "broad" },
      new Set(),
      CARRIER_MATRIX,
      INSURER_MATRIX
    );
    if (!outcome.ok) throw new Error("expected projection to succeed");
    const { projection } = outcome;
    expect(projection.carrier).toBeNull();
    expect(projection.insuranceProduct?.id).toBe("broad");
    // Recommended limit = 100,000 (no buffers); product limit 150k → applied 100k
    expect(projection.appliedInsuranceLimitUsd).toBe(100000);
    expect(projection.projectedProfile.coverageGapUsd).toBe(0);
    expect(projection.factorDeltas.map((delta) => delta.factor)).toContain("coverage");
  });

  it("records both picks and re-scores ONCE with both substitutions", () => {
    const intake = record();
    const profile = score(intake);
    const outcome = buildActionedProjectionFromPicks(
      intake,
      profile,
      { carrierId: "good", insuranceProductId: "broad" },
      new Set(),
      CARRIER_MATRIX,
      INSURER_MATRIX
    );
    if (!outcome.ok) throw new Error("expected projection to succeed");
    const { projection } = outcome;
    expect(projection.carrier?.id).toBe("good");
    expect(projection.insuranceProduct?.id).toBe("broad");
    // Carrier swap (liability → 200k, ratings → 1/1) + insurance (100k) in one position.
    // Eff coverage = min(100k insurance, 200k liability) = 100k → gap 0.
    expect(projection.projectedProfile.coverageGapUsd).toBe(0);
    expect(projection.projectedProfile.score).toBeLessThan(profile.score);
    // One coherent position — deterministic across runs.
    const rerun = buildActionedProjectionFromPicks(
      intake,
      profile,
      { carrierId: "good", insuranceProductId: "broad" },
      new Set(),
      CARRIER_MATRIX,
      INSURER_MATRIX
    );
    if (!rerun.ok) throw new Error("expected re-run projection to succeed");
    expect(rerun.projection).toEqual(projection);
  });

  it("refuses an insurance product that is not in the matrix", () => {
    const outcome = buildActionedProjectionFromPicks(
      record(),
      score(record()),
      { insuranceProductId: "ghost-product" },
      new Set(),
      CARRIER_MATRIX,
      INSURER_MATRIX
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("ghost-product");
  });

  it("refuses an insurance product that does not match the record", () => {
    const unfit: InsurerFitMatrix = {
      sourceLabel: "unfit",
      products: [
        {
          id: "rail-only",
          insurerName: "Rail Insurance Co",
          productName: "Rail Cargo",
          modes: ["rail"],
          supportedCargoTypes: ["general_dry"],
          supportedHazardClasses: ["none"],
          maxLaneRisk: "high",
          coverageLimitUsd: 150000,
          liabilityTerms: "All-risk",
        },
      ],
    };
    const outcome = buildActionedProjectionFromPicks(
      record(), // road record
      score(record()),
      { insuranceProductId: "rail-only" },
      new Set(),
      CARRIER_MATRIX,
      unfit
    );
    expect(outcome.ok).toBe(false);
  });

  it("refuses a transition with no picks at all", () => {
    const outcome = buildActionedProjectionFromPicks(record(), score(record()), {});
    expect(outcome.ok).toBe(false);
  });

  it("keeps the carrier-only path intact through the delegating wrapper", () => {
    const intake = record();
    const profile = score(intake);
    const outcome = buildActionedProjection(
      intake,
      profile,
      "good",
      new Set(),
      CARRIER_MATRIX
    );
    if (!outcome.ok) throw new Error("expected projection to succeed");
    expect(outcome.projection.carrier.id).toBe("good");
    // Carrier liability substituted to 200k — same as the record's own, so the gap holds at 0;
    // the improvement comes from the carrier-record factor, not the coverage factor.
    expect(outcome.projection.projectedProfile.score).toBeLessThan(profile.score);
  });
});

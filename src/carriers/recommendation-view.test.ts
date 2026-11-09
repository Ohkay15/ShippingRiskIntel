import { describe, expect, it } from "vitest";

import { shipmentIntakeSchema } from "@/schemas/shipment";
import { score } from "@/scoring/engine";

import { factorDeltas, projectCarrierProfile, type CarrierRecommendation } from "./recommend";
import type { CarrierFitEntry } from "./schema";
import { actionedView, factorDeltaViews, factorLabel, recommendationViews } from "./recommendation-view";

function record() {
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
    value_fragility: { declaredValueUsd: 10000, fragilityClass: "low" },
    sensitivity: { delaySensitivity: "flexible" },
    escalation: { escalationExposure: "contained" },
    coverage: { insuranceCoverageUsd: 20000, carrierLiabilityLimitUsd: 20000 },
  });
}

const CARRIER: CarrierFitEntry = {
  id: "good",
  name: "Good Carrier",
  modes: ["road"],
  supportedCargoTypes: ["general_dry"],
  maxLaneRisk: "high",
  hazmatCertifications: [],
  insuranceOfferingUsd: null,
  liabilityLimitUsd: 20000,
  safetyRating: 1,
  claimsRating: 1,
};

describe("factorLabel", () => {
  it("uses the same labels as the intake form registry", () => {
    expect(factorLabel("carrier_record")).toBe("Carrier & shipper record");
    expect(factorLabel("coverage")).toBe("Coverage vs. value");
  });
});

describe("factorDeltaViews", () => {
  it("formats a concrete before → after with a signed delta", () => {
    const intake = record();
    const before = score(intake);
    const after = projectCarrierProfile(intake, CARRIER);
    const views = factorDeltaViews(factorDeltas(before, after));
    expect(views.length).toBeGreaterThan(0);
    const carrierDelta = views.find((view) => view.key === "carrier_record")!;
    expect(carrierDelta.label).toBe("Carrier & shipper record");
    expect(carrierDelta.beforeText).toBe("5 × 4");
    expect(carrierDelta.afterText).toBe("1 × 2");
    expect(carrierDelta.deltaText).toMatch(/^-/);
    expect(carrierDelta.improves).toBe(true);
  });

  it("prefixes a worsening delta with a plus", () => {
    const views = factorDeltaViews([
      {
        factor: "coverage",
        before: { likelihood: 1, consequence: 1, contribution: 0.06 },
        after: { likelihood: 3, consequence: 5, contribution: 0.9 },
        contributionDelta: 0.84,
      },
    ]);
    expect(views[0].deltaText).toBe("+0.84");
    expect(views[0].improves).toBe(false);
  });
});

describe("recommendationViews", () => {
  it("maps engine recommendations to display rows", () => {
    const intake = record();
    const profile = score(intake);
    const projected = projectCarrierProfile(intake, CARRIER);
    const rec: CarrierRecommendation = {
      carrier: CARRIER,
      projectedProfile: projected,
      scoreDelta: Math.round((projected.score - profile.score) * 100) / 100,
      factorDeltas: factorDeltas(profile, projected),
    };
    const views = recommendationViews([rec]);
    expect(views).toHaveLength(1);
    expect(views[0].carrierId).toBe("good");
    expect(views[0].carrierName).toBe("Good Carrier");
    expect(views[0].improves).toBe(true);
    expect(views[0].factors.map((f) => f.key)).toContain("carrier_record");
  });
});

describe("actionedView", () => {
  it("falls back to the raw id when the carrier left the matrix", () => {
    const intake = record();
    const profile = score(intake);
    const view = actionedView("removed-carrier", null, profile, null);
    expect(view.carrierName).toBe("removed-carrier");
    expect(view.carrierFound).toBe(false);
    expect(view.projectedScore).toBeNull();
    expect(view.factors).toEqual([]);
  });

  it("shows the stored projection's position and factor deltas", () => {
    const intake = record();
    const profile = score(intake);
    const projected = projectCarrierProfile(intake, CARRIER);
    const view = actionedView("good", "Good Carrier", profile, projected);
    expect(view.carrierFound).toBe(true);
    expect(view.projectedScore).toBe(projected.score);
    expect(view.projectedCell).toBe(projected.cell);
    expect(view.factors.map((f) => f.key)).toContain("carrier_record");
  });
});

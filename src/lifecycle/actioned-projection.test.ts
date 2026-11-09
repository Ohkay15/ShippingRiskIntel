import { describe, expect, it } from "vitest";

import type { CarrierFitMatrix } from "@/carriers/schema";
import { score, type RiskProfile } from "@/scoring/engine";
import { shipmentIntakeSchema } from "@/schemas/shipment";

import { canTransition } from "@/lifecycle/machine";
import { buildActionedProjection } from "./actioned-projection";

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

const MATRIX: CarrierFitMatrix = {
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
      liabilityLimitUsd: 20000,
      safetyRating: 1,
      claimsRating: 1,
    },
    {
      id: "unfit",
      name: "Unfit Carrier",
      modes: ["rail"],
      supportedCargoTypes: ["general_dry"],
      maxLaneRisk: "low",
      hazmatCertifications: [],
      insuranceOfferingUsd: null,
      liabilityLimitUsd: 5000,
      safetyRating: 1,
      claimsRating: 1,
    },
  ],
};

describe("buildActionedProjection", () => {
  it("projects a real engine score for the chosen carrier", () => {
    const intake = record();
    const profile = score(intake);
    const outcome = buildActionedProjection(intake, profile, "good", new Set(), MATRIX);
    if (!outcome.ok) throw new Error("expected projection to succeed");
    expect(outcome.projection.carrier.id).toBe("good");
    expect(outcome.projection.projectedProfile.score).toBeLessThan(profile.score);
    expect(outcome.projection.factorDeltas.map((d) => d.factor)).toContain("carrier_record");
  });

  it("refuses a carrier that is not in the matrix", () => {
    const outcome = buildActionedProjection(
      record(),
      score(record()),
      "ghost-carrier",
      new Set(),
      MATRIX
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain("ghost-carrier");
    }
  });

  it("refuses a matching-id carrier that does not fit the record", () => {
    const outcome = buildActionedProjection(
      record(),
      score(record()),
      "unfit",
      new Set(),
      MATRIX
    );
    expect(outcome.ok).toBe(false);
  });

  it("is deterministic for the same inputs", () => {
    const intake = record();
    const profile = score(intake);
    const a = buildActionedProjection(intake, profile, "good", new Set(), MATRIX);
    const b = buildActionedProjection(intake, profile, "good", new Set(), MATRIX);
    expect(a).toEqual(b);
  });
});

describe("the Scored → Actioned edge in the state machine", () => {
  it("allows scored → actioned and keeps actioned locked from scoring paths", () => {
    expect(canTransition("scored", "actioned")).toBe(true);
    expect(canTransition("actioned", "actioned")).toBe(false);
    expect(canTransition("needs_review", "actioned")).toBe(false);
    expect(canTransition("draft", "actioned")).toBe(false);
  });

  it("the projection keeps the original profile intact", () => {
    const intake = record();
    const profile: RiskProfile = score(intake);
    const outcome = buildActionedProjection(intake, profile, "good", new Set(), MATRIX);
    if (!outcome.ok) throw new Error("expected projection to succeed");
    // The stored profile must remain the record's own score — the
    // projection lives beside it, never replaces it.
    expect(profile.score).toBe(score(intake).score);
    expect(outcome.projection.projectedProfile.score).not.toBe(profile.score);
  });
});

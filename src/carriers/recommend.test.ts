import { describe, expect, it } from "vitest";

import { shipmentIntakeSchema, type ShipmentIntake } from "@/schemas/shipment";
import { DEFAULT_SCORING_CONFIG } from "@/scoring/config";
import { score, type RiskProfile } from "@/scoring/engine";

import { PLACEHOLDER_CARRIER_FIT_MATRIX } from "./matrix-data";
import type { CarrierFitMatrix } from "./schema";
import {
  carrierMatches,
  factorDeltas,
  projectCarrierProfile,
  recommendCarriers,
  substituteCarrier,
} from "./recommend";

/** A fully-scoreable clean record (no review flags, LL profile). */
function cleanRecord(patch: Record<string, unknown> = {}): ShipmentIntake {
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
    ...patch,
  });
}

function entry(patch: Record<string, unknown>) {
  return {
    id: "test-carrier",
    name: "Test Carrier",
    modes: ["road"],
    supportedCargoTypes: ["general_dry"],
    maxLaneRisk: "high",
    liabilityLimitUsd: 100000,
    insuranceOfferingUsd: null,
    safetyRating: 1,
    claimsRating: 1,
    ...patch,
  } as CarrierFitMatrix["carriers"][number];
}

describe("substituteCarrier", () => {
  it("overwrites only carrier-owned fields", () => {
    const record = cleanRecord();
    const substituted = substituteCarrier(record, entry({ id: "c1", name: "C1" }));
    expect(substituted.carrier_record.carrierId).toBe("c1");
    expect(substituted.carrier_record.carrierSafetyRating).toBe(1);
    expect(substituted.coverage.carrierLiabilityLimitUsd).toBe(100000);
    // The shipper's own insurance amount and everything else is untouched.
    expect(substituted.coverage.insuranceCoverageUsd).toBe(20000);
    expect(substituted.value_fragility).toBe(record.value_fragility);
  });
});

describe("carrierMatches", () => {
  const record = cleanRecord();
  const profile = { cell: "LL" } as RiskProfile;

  it("matches a carrier that covers the cargo, mode, and lane risk", () => {
    expect(carrierMatches(record, profile, entry({}))).toBe(true);
  });

  it("rejects a carrier whose supported cargo misses a record category", () => {
    const hazmat = cleanRecord({ cargo_hazard: { hazardClass: "3" } });
    expect(carrierMatches(hazmat, profile, entry({}))).toBe(false);
    expect(
      carrierMatches(hazmat, profile, entry({ supportedCargoTypes: ["general_dry", "hazmat"] }))
    ).toBe(true);
  });

  it("rejects a carrier that does not run the record's mode", () => {
    expect(carrierMatches(record, profile, entry({ modes: ["rail"] }))).toBe(false);
  });

  it("skips the mode filter when the record's mode is unknown", () => {
    const noMode = cleanRecord({ route_lane: { origin: "A", destination: "B" } });
    expect(carrierMatches(noMode, profile, entry({ modes: ["rail"] }))).toBe(true);
  });

  it("rejects a carrier whose max lane risk is below the profile cell's tier", () => {
    expect(carrierMatches(record, { cell: "HH" } as RiskProfile, entry({ maxLaneRisk: "low" }))).toBe(
      false
    );
    expect(
      carrierMatches(record, { cell: "HH" } as RiskProfile, entry({ maxLaneRisk: "high" }))
    ).toBe(true);
  });
});

describe("recommendCarriers", () => {
  it("returns at most three carriers, ranked by projected score", () => {
    const record = cleanRecord();
    const profile = score(record);
    const matrix: CarrierFitMatrix = {
      sourceLabel: "test",
      carriers: [
        entry({ id: "mid", safetyRating: 2, claimsRating: 2 }),
        entry({ id: "best", safetyRating: 1, claimsRating: 1 }),
        entry({ id: "worst", safetyRating: 5, claimsRating: 5 }),
        entry({ id: "poor", safetyRating: 4, claimsRating: 4 }),
      ],
    };
    const recs = recommendCarriers(record, profile, matrix);
    expect(recs).toHaveLength(3);
    const projected = recs.map((r) => r.projectedProfile.score);
    expect(projected).toEqual([...projected].sort((a, b) => a - b));
    // The worst carrier cannot be in the top three while better ones fit.
    expect(recs.map((r) => r.carrier.id)).not.toContain("worst");
  });

  it("returns an empty list when no carrier fits", () => {
    const oceanRecord = cleanRecord({ route_lane: { mode: "ocean" } });
    const recs = recommendCarriers(
      oceanRecord,
      score(oceanRecord),
      PLACEHOLDER_CARRIER_FIT_MATRIX
    );
    expect(recs).toEqual([]);
  });

  it("recommends placeholder carriers for a clean domestic record", () => {
    const record = cleanRecord();
    const recs = recommendCarriers(record, score(record), PLACEHOLDER_CARRIER_FIT_MATRIX);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.length).toBeLessThanOrEqual(3);
    // Every recommendation improves or holds the score — the projection
    // replaces a 5/5 carrier record, so the delta must be negative.
    for (const rec of recs) {
      expect(rec.scoreDelta).toBeLessThan(0);
    }
  });
});

describe("projection uses the real engine", () => {
  it("equals scoring the substituted record directly", () => {
    const record = cleanRecord();
    const carrier = entry({ id: "c1", name: "C1", safetyRating: 2, claimsRating: 3 });
    const projected = projectCarrierProfile(record, carrier);
    expect(projected).toEqual(score(substituteCarrier(record, carrier)));
  });

  it("lowers the carrier_record contribution for a better carrier", () => {
    const record = cleanRecord();
    const profile = score(record);
    const beforeCarrier = profile.ratings.find((r) => r.factor === "carrier_record")!;
    const projected = projectCarrierProfile(record, entry({ safetyRating: 1, claimsRating: 1 }));
    const afterCarrier = projected.ratings.find((r) => r.factor === "carrier_record")!;
    expect(afterCarrier.likelihood).toBeLessThan(beforeCarrier.likelihood);
    expect(projected.score).toBeLessThan(profile.score);
  });
});

describe("factorDeltas", () => {
  it("lists only the factors that moved, with concrete deltas", () => {
    const record = cleanRecord();
    const profile = score(record);
    const projected = projectCarrierProfile(
      record,
      entry({ id: "c1", name: "C1", safetyRating: 1, claimsRating: 1 })
    );
    const deltas = factorDeltas(profile, projected);
    // Only carrier_record changed (the liability limit stayed above the
    // gap threshold, so coverage holds still).
    expect(deltas.map((d) => d.factor)).toEqual(["carrier_record"]);
    const delta = deltas[0];
    expect(delta.before.likelihood).toBe(5);
    expect(delta.after.likelihood).toBe(1);
    expect(delta.contributionDelta).toBeCloseTo(
      delta.after.contribution - delta.before.contribution,
      10
    );
    expect(delta.contributionDelta).toBeLessThan(0);
  });

  it("captures the coverage factor when the liability limit changes the gap", () => {
    const record = cleanRecord({
      coverage: { insuranceCoverageUsd: 10000, carrierLiabilityLimitUsd: 10000 },
    });
    // Shipper insurance 10k = value; with the original 10k liability limit
    // the gap is 0 (fully covered). A 100k liability limit keeps min() at
    // 10k, so coverage holds — swap to a low-limit carrier to move it.
    const profile = score(record);
    const projected = projectCarrierProfile(
      record,
      entry({ liabilityLimitUsd: 2000 })
    );
    const factors = factorDeltas(profile, projected).map((d) => d.factor);
    expect(factors).toContain("coverage");
  });

  it("is empty when the projection changes nothing", () => {
    const record = cleanRecord({
      carrier_record: {
        carrierId: "same",
        carrierName: "Same",
        carrierSafetyRating: 1,
        carrierClaimsRating: 1,
      },
    });
    const profile = score(record);
    const projected = projectCarrierProfile(
      record,
      entry({ safetyRating: 1, claimsRating: 1, liabilityLimitUsd: 20000 })
    );
    expect(factorDeltas(profile, projected)).toEqual([]);
  });
});

describe("determinism", () => {
  it("produces identical recommendations for identical inputs", () => {
    const record = cleanRecord();
    const profile = score(record, DEFAULT_SCORING_CONFIG);
    const a = recommendCarriers(record, profile, PLACEHOLDER_CARRIER_FIT_MATRIX);
    const b = recommendCarriers(record, profile, PLACEHOLDER_CARRIER_FIT_MATRIX);
    expect(a).toEqual(b);
  });
});

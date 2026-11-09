import { describe, expect, it } from "vitest";

import { shipmentIntakeSchema } from "@/schemas/shipment";
import { score } from "@/scoring/engine";

import { recommendCoverageLimit } from "./limit";

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

describe("recommendCoverageLimit", () => {
  it("sizes the limit to declared value with no buffer for plain cargo", () => {
    const intake = record();
    const rec = recommendCoverageLimit(intake, score(intake));
    expect(rec.recommendedLimitUsd).toBe(100000);
    expect(rec.buffers).toEqual([]);
    expect(rec.totalBufferPercent).toBe(0);
    expect(rec.rationale).toContain("$100,000");
    expect(rec.rationale).toContain("no fragility, sensitivity, or escalation premium");
  });

  it("reads a fully covered record as adequate", () => {
    const intake = record({ coverage: { insuranceCoverageUsd: 150000, carrierLiabilityLimitUsd: 200000 } });
    const rec = recommendCoverageLimit(intake, score(intake));
    expect(rec.currentlyAdequate).toBe(true);
    expect(rec.currentGapUsd).toBeLessThanOrEqual(0);
    expect(rec.rationale).toContain("already meets this limit");
  });

  it("adds buffers for fragile, perishable, spreading cargo and rounds up to $1,000", () => {
    const intake = record({
      value_fragility: { declaredValueUsd: 100500, fragilityClass: "ultra" },
      sensitivity: { delaySensitivity: "perishable" },
      escalation: { escalationExposure: "spreads" },
    });
    const rec = recommendCoverageLimit(intake, score(intake));
    expect(rec.totalBufferPercent).toBe(50); // 30 ultra + 10 perishable + 10 spreads
    // 100,500 × 1.5 = 150,750 → rounds UP to 151,000
    expect(rec.recommendedLimitUsd).toBe(151000);
    expect(rec.buffers.map((buffer) => buffer.driver)).toEqual([
      "fragility",
      "sensitivity",
      "escalation",
    ]);
    expect(rec.rationale).toContain("50% buffer");
  });

  it("adds a jit buffer without an escalation one for contained jit cargo", () => {
    const intake = record({
      value_fragility: { declaredValueUsd: 100000, fragilityClass: "high" },
      sensitivity: { delaySensitivity: "jit" },
    });
    const rec = recommendCoverageLimit(intake, score(intake));
    expect(rec.totalBufferPercent).toBe(20); // 15 high + 5 jit
    expect(rec.recommendedLimitUsd).toBe(120000);
  });

  it("returns no limit when declared value is unknown, and says why", () => {
    const intake = record({ value_fragility: { fragilityClass: "low" } });
    const rec = recommendCoverageLimit(intake, score(intake));
    expect(rec.recommendedLimitUsd).toBeNull();
    expect(rec.currentlyAdequate).toBeNull();
    expect(rec.rationale).toContain("declared value");
  });

  it("never treats missing coverage data as covered or inadequate", () => {
    const intake = record({ coverage: {} });
    const rec = recommendCoverageLimit(intake, score(intake));
    expect(rec.currentEffectiveCoverageUsd).toBeNull();
    expect(rec.currentlyAdequate).toBeNull();
    expect(rec.currentGapUsd).toBeNull();
    expect(rec.recommendedLimitUsd).toBe(100000); // sizing does not depend on coverage data
    expect(rec.rationale).toContain("never treated as covered");
  });

  it("cites the scored factor ratings for the buffer-driving factors as evidence", () => {
    const intake = record();
    const profile = score(intake);
    const rec = recommendCoverageLimit(intake, profile);
    expect(rec.evidence.map((entry) => entry.factor)).toEqual([
      "value_fragility",
      "sensitivity",
      "escalation",
    ]);
    for (const entry of rec.evidence) {
      const rating = profile.ratings.find((r) => r.factor === entry.factor);
      expect(entry.likelihood).toBe(rating?.likelihood);
      expect(entry.consequence).toBe(rating?.consequence);
    }
  });

  it("is deterministic — same record and profile, same recommendation", () => {
    const intake = record();
    const profile = score(intake);
    expect(recommendCoverageLimit(intake, profile)).toEqual(recommendCoverageLimit(intake, profile));
  });
});

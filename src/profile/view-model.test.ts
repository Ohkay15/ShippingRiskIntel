import { describe, expect, it } from "vitest";

import type { FactorRating, RiskProfile } from "@/scoring/engine";
import { score } from "@/scoring/engine";
import { DEFAULT_SCORING_CONFIG } from "@/scoring/config";
import { buildDemoDataset } from "@/scoring/demo-seed";
import {
  factorBasisView,
  factorContribution,
  factorRows,
  matrixPlacement,
  recordSummary,
} from "./view-model";
import type { ShipmentIntake } from "@/schemas/shipment";

/** The cleanest record in the synthetic corpus — its intake fields are real. */
function cleanRecord(): ShipmentIntake {
  const rows = buildDemoDataset();
  const cleanest = rows.reduce((best, row) =>
    row.profile.score < best.profile.score ? row : best
  );
  return cleanest.intakeData;
}

describe("factorBasisView", () => {
  it("renders a rule basis with its config note", () => {
    const view = factorBasisView({
      source: "rule",
      ruleId: "cargo_dg_class_1",
      note: "UN-classified dangerous goods with acute incident potential",
    });
    expect(view.kind).toBe("rule");
    expect(view.label).toBe("Rule");
    expect(view.detail).toContain("cargo_dg_class_1");
    expect(view.detail).toContain("dangerous goods");
    expect(view.confidence).toBeNull();
  });

  it("renders an LLM basis with evidence and confidence", () => {
    const view = factorBasisView({
      source: "llm",
      confidence: 0.88,
      evidence: '"UN 1993 flammable" reads the invoice',
    });
    expect(view.kind).toBe("llm");
    expect(view.label).toBe("LLM judgment");
    expect(view.detail).toContain("UN 1993");
    expect(view.confidence).toBeCloseTo(0.88);
  });

  it("renders a review basis naming the reviewer", () => {
    const view = factorBasisView({ source: "review", reviewerId: "operator" });
    expect(view.kind).toBe("review");
    expect(view.detail).toContain("operator");
  });

  it("renders a conservative-default basis with its reason", () => {
    const view = factorBasisView({ source: "default", reason: "Coverage data missing" });
    expect(view.kind).toBe("default");
    expect(view.detail).toBe("Coverage data missing");
  });
});

describe("factorContribution", () => {
  it("multiplies likelihood × consequence × weight", () => {
    const rating = { likelihood: 4, consequence: 5, weight: 0.16 } as FactorRating;
    expect(factorContribution(rating)).toBeCloseTo(3.2);
  });

  it("rounds to two decimals", () => {
    const rating = { likelihood: 3, consequence: 3, weight: 0.083 } as FactorRating;
    expect(factorContribution(rating)).toBeCloseTo(0.75);
  });
});

describe("factorRows", () => {
  it("orders factors by contribution, drivers first", () => {
    const profile = score(cleanRecord(), DEFAULT_SCORING_CONFIG);
    const rows = factorRows(profile);
    expect(rows).toHaveLength(10);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1].contribution).toBeGreaterThanOrEqual(rows[i].contribution);
    }
    expect(rows[0].label).not.toBe("");
  });
});

describe("matrixPlacement", () => {
  it("places LL at the low corner of both axes", () => {
    const profile = score(cleanRecord(), DEFAULT_SCORING_CONFIG);
    const placement = matrixPlacement(profile);
    if (profile.cell !== "LL") throw new Error("clean record should land LL");
    expect(placement.likelihoodPct).toBeLessThan(50);
    expect(placement.consequencePct).toBeLessThan(50);
  });

  it("clamps to 0–100 percent for any 1–5 index", () => {
    const make = (likelihoodIndex: number, consequenceIndex: number) =>
      matrixPlacement({
        cell: "HH",
        likelihoodIndex,
        consequenceIndex,
      } as RiskProfile);
    for (const idx of [1, 2.5, 5]) {
      const placement = make(idx, idx);
      expect(placement.likelihoodPct).toBeGreaterThanOrEqual(0);
      expect(placement.likelihoodPct).toBeLessThanOrEqual(100);
      expect(placement.consequencePct).toBeGreaterThanOrEqual(0);
      expect(placement.consequencePct).toBeLessThanOrEqual(100);
    }
    expect(make(1, 1).likelihoodPct).toBe(0);
    expect(make(5, 5).consequencePct).toBe(100);
  });
});

describe("recordSummary", () => {
  it("joins cargo, route, and mode", () => {
    expect(
      recordSummary({
        cargo_hazard: { cargoDescription: "Palletized electronics", unNumber: null },
        route_lane: { origin: "Chicago, IL", destination: "Dallas, TX", mode: "road_drayage" },
        value_fragility: { declaredValueUsd: 90000 },
      })
    ).toBe("Palletized electronics · Chicago, IL → Dallas, TX · road_drayage");
  });

  it("falls back to the lane id when origin/destination are missing", () => {
    expect(
      recordSummary({
        cargo_hazard: { cargoDescription: "Bulk resin", unNumber: null },
        route_lane: { origin: null, destination: null, mode: null, laneId: "US-IAD-MEX-QRO" } as never,
        value_fragility: { declaredValueUsd: 1000 },
      })
    ).toBe("Bulk resin · US-IAD-MEX-QRO");
  });

  it("returns a placeholder when nothing is recorded", () => {
    expect(
      recordSummary({
        cargo_hazard: { cargoDescription: null, unNumber: null },
        route_lane: { origin: null, destination: null, mode: null },
        value_fragility: { declaredValueUsd: null },
      })
    ).toBe("No description recorded");
  });
});

import { describe, expect, it } from "vitest";

import type { InsurerFitEntry, InsurerFitMatrix } from "@/insurance/schema";
import { shipmentIntakeSchema } from "@/schemas/shipment";
import { score } from "@/scoring/engine";

import { recommendInsurance } from "./recommend";
import {
  gapStateText,
  insuranceRecommendationViews,
  limitGuidanceView,
} from "./recommendation-view";
import { recommendCoverageLimit } from "./limit";
/**
 * Tests for the insurance UI wiring: the pure view models the profile
 * panel renders. The panel itself only renders these strings — so the
 * wiring contract (limit guidance leads, cards show concrete dollar
 * deltas, the carrier-liability cap is explained) is pinned here.
 */

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
      coverageLimitUsd: 150000,
    }),
    product({
      id: "capped",
      insurerName: "Capped Coverage Ltd",
      productName: "Cargo Saver",
      coverageLimitUsd: 60000,
    }),
  ],
};

/** The panel's actual wiring: guidance first, then recommendations against it. */
function wired(intake: ReturnType<typeof record>) {
  const profile = score(intake);
  const guidance = recommendCoverageLimit(intake, profile);
  return {
    profile,
    guidance,
    recommendations: recommendInsurance(intake, profile, MATRIX, guidance.recommendedLimitUsd),
  };
}

describe("insuranceRecommendationViews", () => {
  it("shows a concrete before → after gap and a negative dollar delta on an under-covered record", () => {
    const intake = record();
    const { profile, recommendations } = wired(intake);
    // Declared 100k, effective coverage min(20k, 200k) = 20k → gap $80,000.
    expect(profile.coverageGapUsd).toBe(80000);

    const [view] = insuranceRecommendationViews(recommendations, profile.coverageGapUsd);

    expect(view.gapBeforeText).toBe("$80,000 uncovered");
    // The broad product applies min(150k limit, 100k recommended) = 100k → gap closed.
    expect(view.gapAfterText).toBe("gap closed");
    expect(view.gapDeltaShortText).toBe("−$80,000");
    expect(view.gapDeltaText).toContain("$80,000");
    expect(view.improves).toBe(true);
    expect(typeof view.projectedScore).toBe("number");
  });

  it("reports no delta when the carrier's liability limit is the binding cap", () => {
    const intake = record({
      coverage: { insuranceCoverageUsd: 20000, carrierLiabilityLimitUsd: 20000 },
    });
    const { profile, recommendations } = wired(intake);

    const [view] = insuranceRecommendationViews(recommendations, profile.coverageGapUsd);

    expect(view.cappedByCarrierLiability).toBe(true);
    expect(view.effectiveCoverageText).toContain("$20,000 after the carrier's $20,000 liability limit");
    expect(view.effectiveCoverageText).toContain("binding cap");
    // Gap math takes min(insurance, liability) — the product cannot close it alone.
    expect(view.gapDeltaShortText).toBe("±$0");
    expect(view.improves).toBe(false);
  });

  it("keeps the effective-coverage row present but uncapped when the product sits above the liability limit", () => {
    const intake = record({
      coverage: { insuranceCoverageUsd: 50000, carrierLiabilityLimitUsd: 80000 },
    });
    const { profile, recommendations } = wired(intake);

    const [view] = insuranceRecommendationViews(recommendations, profile.coverageGapUsd);

    // Applied min(150k, 100k recommended) = 100k > 80k liability → capped.
    expect(view.cappedByCarrierLiability).toBe(true);
    expect(view.effectiveCoverageText).toContain("$80,000 after the carrier's $80,000 liability limit");
  });

  it("reads an unknown gap as unknown, never $0", () => {
    expect(gapStateText(null)).toBe("gap unknown");
  });
});

describe("limitGuidanceView", () => {
  it("leads with the recommended limit, the buffer rationale, and the shortfall", () => {
    const intake = record();
    const guidance = limitGuidanceView(recommendCoverageLimit(intake, score(intake)));

    expect(guidance.status).toBe("shortfall");
    expect(guidance.headline).toBe("$100,000");
    expect(guidance.rationale).toContain("$100,000");
    expect(guidance.rationale).toContain("declared value");
    expect(guidance.shortfallText).toBe("$80,000");
  });

  it("reports adequate coverage when current coverage meets the recommendation", () => {
    const intake = record({
      coverage: { insuranceCoverageUsd: 150000, carrierLiabilityLimitUsd: 200000 },
    });
    const guidance = limitGuidanceView(recommendCoverageLimit(intake, score(intake)));

    expect(guidance.status).toBe("adequate");
    expect(guidance.shortfallText).toBeNull();
  });
});

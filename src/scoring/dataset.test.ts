import { describe, expect, it } from "vitest";
import { FACTOR_KEYS } from "../schemas/shipment";
import { DEFAULT_SCORING_CONFIG } from "./config";
import { scoreSyntheticDataset, SYNTHETIC_DATASET_CORRIDOR, syntheticShipments } from "./dataset";

const scored = scoreSyntheticDataset();

describe("synthetic dataset — shape", () => {
  it("contains 40 records with unique sequential ids", () => {
    expect(syntheticShipments).toHaveLength(40);
    const ids = syntheticShipments.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(40);
    for (let index = 0; index < ids.length; index += 1) {
      expect(ids[index]).toBe(`SH-${String(index + 1).padStart(3, "0")}`);
    }
  });

  it("documents the intra-US corridor as a labeled default pending owner input", () => {
    expect(SYNTHETIC_DATASET_CORRIDOR).toContain("intra-US");
    expect(SYNTHETIC_DATASET_CORRIDOR).toContain("pending owner input");
  });

  it("labels every record with its scenario intent", () => {
    for (const entry of syntheticShipments) {
      expect(entry.label.length).toBeGreaterThan(10);
    }
  });
});

describe("synthetic dataset — profile integrity", () => {
  it("rates all ten factors in order with a basis and config weight", () => {
    for (const { profile } of scored) {
      expect(profile.ratings.map((rating) => rating.factor)).toEqual([...FACTOR_KEYS]);
      for (const rating of profile.ratings) {
        expect(rating.weight).toBe(DEFAULT_SCORING_CONFIG.weights[rating.factor]);
        expect(rating.basis.source).toBeDefined();
      }
    }
  });

  it("rates every DG record without a cert on file from dg_cert_missing", () => {
    for (const { id, record, profile } of scored) {
      if (record.cargo_hazard.hazardClass !== "none" && record.packing_certs.dgCertPresent === false) {
        const packing = profile.ratings.find((rating) => rating.factor === "packing_certs");
        expect(packing?.basis, id).toMatchObject({ source: "rule", ruleId: "dg_cert_missing" });
      }
    }
  });
});

describe("synthetic dataset — matrix spread", () => {
  it("spans all four quadrants of the matrix", () => {
    const count = (cell: string) => scored.filter(({ profile }) => profile.cell === cell).length;
    expect(count("LL")).toBeGreaterThanOrEqual(8);
    expect(count("LH")).toBeGreaterThanOrEqual(5);
    expect(count("HL")).toBeGreaterThanOrEqual(5);
    expect(count("HH")).toBeGreaterThanOrEqual(8);
  });

  it("separates the corners — clean dry goods score low, stacked-hazard records score high", () => {
    const scores = scored.map(({ profile }) => profile.score);
    expect(Math.min(...scores)).toBeLessThan(2.5);
    expect(Math.max(...scores)).toBeGreaterThan(9.5);
    expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThan(7);
  });

  it("never lets an obviously dangerous record score benign", () => {
    for (const { id, record, profile } of scored) {
      if (record.cargo_hazard.hazardClass !== "none" && record.packing_certs.dgCertPresent === false) {
        expect(profile.score, id).toBeGreaterThan(5);
      }
    }
  });
});

describe("synthetic dataset — coverage gap", () => {
  it("exercises all three gap states: covered, underinsured, unknown", () => {
    const gaps = scored.map(({ profile }) => profile.coverageGapUsd);
    // Spec formula is the raw difference, so full coverage reads as a surplus
    // (negative) rather than a clamped $0 — display clamping is the UI's call.
    expect(gaps.filter((gap) => gap != null && gap <= 0).length).toBeGreaterThanOrEqual(20);
    expect(gaps.filter((gap) => gap != null && gap > 0).length).toBeGreaterThanOrEqual(10);
    const unknown = gaps.filter((gap) => gap === null);
    expect(unknown.length).toBeGreaterThanOrEqual(2);
  });

  it("flags the coverage factor for review on every unknown-coverage record", () => {
    for (const { id, record, profile } of scored) {
      if (record.coverage.insuranceCoverageUsd == null && record.coverage.carrierLiabilityLimitUsd == null) {
        expect(profile.coverageGapUsd, id).toBeNull();
        expect(profile.needsReview, id).toBe(true);
        expect(profile.reviewFlags.map((flag) => flag.factor), id).toContain("coverage");
      }
    }
  });
});

describe("synthetic dataset — engine contract at corpus scale", () => {
  it("is deterministic across the whole dataset", () => {
    expect(scoreSyntheticDataset()).toEqual(scored);
  });

  it("scores the entire dataset in under 100ms", () => {
    const started = performance.now();
    scoreSyntheticDataset();
    expect(performance.now() - started).toBeLessThan(100);
  });
});

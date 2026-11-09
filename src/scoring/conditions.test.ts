import { describe, expect, it } from "vitest";
import { conditionSchema, evaluateCondition, resolveField } from "./conditions";

/** Record view shaped like the engine's: intake groups under `record`, derivations under `derived`. */
const view = {
  record: {
    cargo_hazard: { hazardClass: "3", cargoDescription: "Acetone drums" },
    packing_certs: { dgCertPresent: false, ispm15CertPresent: true, certExpiryDate: "2025-06-30" },
    live_conditions: { conditions: ["severe_weather", "port_congestion"] },
    coverage: { insuranceCoverageUsd: null },
  },
  derived: { coverageGapUsd: null, coverageGapRatio: null, activeDisruptionCount: 2 },
};

describe("evaluateCondition", () => {
  it("matches eq on a present field", () => {
    expect(
      evaluateCondition({ field: "record.cargo_hazard.hazardClass", op: "eq", value: "3" }, view)
    ).toBe(true);
  });

  it("never matches eq on a missing field — unknown is not evidence", () => {
    expect(
      evaluateCondition({ field: "record.coverage.insuranceCoverageUsd", op: "eq", value: null }, view)
    ).toBe(false);
    expect(
      evaluateCondition({ field: "record.route_lane.mode", op: "eq", value: "road" }, view)
    ).toBe(false);
  });

  it("treats neq on a missing field as false", () => {
    expect(
      evaluateCondition({ field: "record.route_lane.mode", op: "neq", value: "rail" }, view)
    ).toBe(false);
  });

  it("matches in-membership and rejects non-members", () => {
    expect(
      evaluateCondition(
        { field: "record.cargo_hazard.hazardClass", op: "in", values: ["3", "8"] },
        view
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: "record.cargo_hazard.hazardClass", op: "in", values: ["1", "2"] },
        view
      )
    ).toBe(false);
  });

  it("matches contains on array fields only", () => {
    expect(
      evaluateCondition(
        { field: "record.live_conditions.conditions", op: "contains", value: "severe_weather" },
        view
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: "record.cargo_hazard.hazardClass", op: "contains", value: "3" },
        view
      )
    ).toBe(false);
  });

  it("treats false as present data for exists — only null and undefined are absent", () => {
    expect(
      evaluateCondition({ field: "record.packing_certs.dgCertPresent", op: "exists", value: true }, view)
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: "record.coverage.insuranceCoverageUsd", op: "exists", value: true },
        view
      )
    ).toBe(false);
    expect(
      evaluateCondition({ field: "record.route_lane.mode", op: "exists", value: false }, view)
    ).toBe(true);
  });

  it("compares numbers", () => {
    expect(evaluateCondition({ field: "derived.activeDisruptionCount", op: "gte", value: 2 }, view)).toBe(true);
    expect(evaluateCondition({ field: "derived.activeDisruptionCount", op: "gt", value: 2 }, view)).toBe(false);
    expect(evaluateCondition({ field: "derived.activeDisruptionCount", op: "lte", value: 2 }, view)).toBe(true);
  });

  it("compares ISO date strings lexicographically", () => {
    expect(
      evaluateCondition(
        { field: "record.packing_certs.certExpiryDate", op: "lt", value: "2026-11-09" },
        view
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: "record.packing_certs.certExpiryDate", op: "gte", value: "2026-11-09" },
        view
      )
    ).toBe(false);
  });

  it("never matches a comparison across mismatched types", () => {
    expect(
      evaluateCondition({ field: "record.cargo_hazard.hazardClass", op: "gt", value: 2 }, view)
    ).toBe(false);
    expect(
      evaluateCondition({ field: "derived.activeDisruptionCount", op: "lt", value: "1" }, view)
    ).toBe(false);
  });

  it("evaluates a missing path inside a comparison as false", () => {
    expect(evaluateCondition({ field: "record.coverage.carrierLiabilityLimitUsd", op: "gt", value: 0 }, view)).toBe(false);
  });

  it("combines and, or, and not", () => {
    expect(
      evaluateCondition(
        {
          and: [
            { field: "record.packing_certs.dgCertPresent", op: "eq", value: false },
            { field: "record.cargo_hazard.hazardClass", op: "in", values: ["3", "8"] },
          ],
        },
        view
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        {
          or: [
            { field: "derived.activeDisruptionCount", op: "gte", value: 5 },
            { field: "record.cargo_hazard.hazardClass", op: "eq", value: "3" },
          ],
        },
        view
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        { not: { field: "record.cargo_hazard.hazardClass", op: "eq", value: "3" } },
        view
      )
    ).toBe(false);
  });
});

describe("resolveField", () => {
  it("walks nested dotted paths", () => {
    expect(resolveField(view, "record.cargo_hazard.hazardClass")).toEqual({
      present: true,
      value: "3",
    });
  });

  it("reports absent lookups without throwing", () => {
    expect(resolveField(view, "record.nonexistent.field")).toEqual({ present: false, value: undefined });
    expect(resolveField(view, "derived")).toMatchObject({ present: true });
  });
});

describe("conditionSchema", () => {
  it("accepts a valid condition", () => {
    expect(
      conditionSchema.safeParse({ field: "record.cargo_hazard.hazardClass", op: "in", values: ["3"] })
        .success
    ).toBe(true);
  });

  it("rejects an unknown op", () => {
    expect(
      conditionSchema.safeParse({ field: "record.cargo_hazard.hazardClass", op: "matches", value: "3" })
        .success
    ).toBe(false);
  });

  it("rejects null members in an in-list — use eq for null instead", () => {
    expect(
      conditionSchema.safeParse({ field: "record.coverage.insuranceCoverageUsd", op: "in", values: [null] })
        .success
    ).toBe(false);
  });

  it("rejects a condition with no field path", () => {
    expect(conditionSchema.safeParse({ field: "", op: "eq", value: "x" }).success).toBe(false);
  });
});

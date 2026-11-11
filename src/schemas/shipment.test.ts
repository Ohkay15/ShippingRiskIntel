import { describe, expect, it } from "vitest";
import {
  FACTOR_KEYS,
  coverageGapUsd,
  shipmentIntakeSchema,
  type ShipmentIntake,
} from "./shipment";

/** Raw (unparsed) input for a minimal well-formed record. */
function rawRecord(overrides: Partial<ShipmentIntake> = {}): Partial<ShipmentIntake> {
  return {
    cargo_hazard: {
      cargoDescription: "Boxed consumer electronics",
      hsCode: "8471.30",
      unNumber: null,
      hazardClass: "none",
    },
    packing_certs: {
      packingType: "Double-wall corrugated cartons, palletized",
      ispm15CertPresent: true,
      dgCertPresent: false,
      certExpiryDate: null,
    },
    carrier_record: {
      carrierId: "car-001",
      carrierName: "Seed Carrier 2",
      carrierSafetyRating: 2,
      carrierClaimsRating: 2,
    },
    route_lane: {
      origin: "Chicago, IL",
      destination: "Dallas, TX",
      mode: "road",
      laneId: "US-IL-TX-01",
    },
    live_conditions: { conditions: [], notes: null },
    load_type: { loadType: "sealed_dedicated", handlingPoints: 0 },
    value_fragility: { declaredValueUsd: 120000, fragilityClass: "medium" },
    sensitivity: { delaySensitivity: "jit" },
    escalation: { escalationExposure: "contained", escalationContact: "ops@example.com" },
    coverage: {
      insuranceCoverageUsd: 150000,
      carrierLiabilityLimitUsd: 100000,
    },
    ...overrides,
  };
}

/** Parsed well-formed record: dry goods, dedicated load, fully covered. */
function cleanRecord(overrides: Partial<ShipmentIntake> = {}): ShipmentIntake {
  return shipmentIntakeSchema.parse(rawRecord(overrides));
}

describe("shipmentIntakeSchema", () => {
  it("defines exactly the ten factor keys from the spec", () => {
    expect(FACTOR_KEYS).toHaveLength(10);
    expect(Object.keys(shipmentIntakeSchema.shape)).toHaveLength(10);
  });

  it("accepts a fully populated record", () => {
    const record = cleanRecord();
    expect(record.cargo_hazard.cargoDescription).toBe("Boxed consumer electronics");
    expect(record.route_lane.mode).toBe("road");
  });

  it("accepts a draft record with every field omitted", () => {
    const draft = shipmentIntakeSchema.parse({});
    expect(draft.cargo_hazard.cargoDescription).toBeUndefined();
    expect(draft.coverage.insuranceCoverageUsd).toBeUndefined();
  });

  it("rejects a malformed UN number when present", () => {
    const bad = rawRecord({
      cargo_hazard: { ...cleanRecord().cargo_hazard, unNumber: "1830" },
    });
    expect(() => shipmentIntakeSchema.parse(bad)).toThrow(/UN number/);
  });

  it("rejects an unknown hazard class", () => {
    const bad = rawRecord({
      cargo_hazard: { ...cleanRecord().cargo_hazard, hazardClass: "10" as never },
    });
    expect(() => shipmentIntakeSchema.parse(bad)).toThrow();
  });

  it("rejects negative declared value", () => {
    const bad = rawRecord({
      value_fragility: { declaredValueUsd: -1, fragilityClass: "low" },
    });
    expect(() => shipmentIntakeSchema.parse(bad)).toThrow(/positive/);
  });

  it("rejects an out-of-range carrier rating", () => {
    const bad = rawRecord({
      carrier_record: { ...cleanRecord().carrier_record, carrierSafetyRating: 6 },
    });
    expect(() => shipmentIntakeSchema.parse(bad)).toThrow();
  });

  it("rejects a malformed certification expiry date", () => {
    const bad = rawRecord({
      packing_certs: { ...cleanRecord().packing_certs, certExpiryDate: "01-2026" },
    });
    expect(() => shipmentIntakeSchema.parse(bad)).toThrow(/ISO date/);
  });
});

describe("coverageGapUsd", () => {
  const value = { declaredValueUsd: 100000 };

  it("gaps against the lower of coverage and carrier liability", () => {
    expect(
      coverageGapUsd(value, { insuranceCoverageUsd: 150000, carrierLiabilityLimitUsd: 80000 })
    ).toBe(20000);
  });

  it("uses coverage alone when no liability limit is on file", () => {
    expect(
      coverageGapUsd(value, { insuranceCoverageUsd: 75000, carrierLiabilityLimitUsd: null })
    ).toBe(25000);
  });

  it("returns null when all coverage data is absent — never a $0 gap", () => {
    expect(
      coverageGapUsd(value, { insuranceCoverageUsd: null, carrierLiabilityLimitUsd: null })
    ).toBeNull();
  });

  it("returns null when declared value is absent", () => {
    expect(
      coverageGapUsd(
        { declaredValueUsd: null },
        { insuranceCoverageUsd: 50000, carrierLiabilityLimitUsd: 50000 }
      )
    ).toBeNull();
  });

  it("reports the full declared value when coverage is near zero", () => {
    expect(
      coverageGapUsd(value, { insuranceCoverageUsd: 0.01, carrierLiabilityLimitUsd: 0.01 })
    ).toBe(99999.99);
  });
});

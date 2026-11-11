import { describe, expect, it } from "vitest";

import { shipmentIntakeSchema, type ShipmentIntake } from "../schemas/shipment";
import { FACTOR_GROUP_META } from "./form-fields";
import { intakePayloadFromFormData } from "./form-data";

/**
 * A complete wire representation of a fully-populated record: exactly what
 * the intake form submits when an operator fills every field of every
 * factor group.
 */
function fullWireValues(): Record<string, string | string[]> {
  return {
    "cargo_hazard.cargoDescription": "Boxed consumer electronics",
    "cargo_hazard.hsCode": "8471.30",
    "cargo_hazard.unNumber": "UN1830",
    "cargo_hazard.hazardClass": "none",
    "packing_certs.packingType": "Double-wall cartons, palletized",
    "packing_certs.ispm15CertPresent": "true",
    "packing_certs.dgCertPresent": "false",
    "packing_certs.certExpiryDate": "2027-06-30",
    "carrier_record.carrierId": "car-001",
    "carrier_record.carrierName": "Seed Carrier 2",
    "carrier_record.carrierSafetyRating": "2",
    "carrier_record.carrierClaimsRating": "3",
    "route_lane.origin": "Chicago, IL",
    "route_lane.destination": "Dallas, TX",
    "route_lane.mode": "road",
    "route_lane.laneId": "US-IL-TX-01",
    "live_conditions.conditions": ["severe_weather", "port_congestion"],
    "live_conditions.notes": "Winter storm advisory",
    "load_type.loadType": "shared",
    "load_type.handlingPoints": "3",
    "value_fragility.declaredValueUsd": "120000",
    "value_fragility.fragilityClass": "medium",
    "sensitivity.delaySensitivity": "jit",
    "escalation.escalationExposure": "contained",
    "escalation.escalationContact": "ops@example.com",
    "coverage.insuranceCoverageUsd": "150000",
    "coverage.carrierLiabilityLimitUsd": "100000",
  };
}

function formDataFrom(wire: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [name, value] of Object.entries(wire)) {
    if (Array.isArray(value)) {
      for (const v of value) fd.append(name, v);
    } else {
      fd.append(name, value);
    }
  }
  return fd;
}

describe("intake form round-trip", () => {
  it("exposes a wire name for every field of all ten factor groups", () => {
    expect(FACTOR_GROUP_META).toHaveLength(10);
    for (const group of FACTOR_GROUP_META) {
      expect(group.fields.length).toBeGreaterThan(0);
      for (const field of group.fields) {
        expect(field.path).toMatch(new RegExp(`^${group.key}\\.`));
      }
    }
  });

  it("round-trips all ten factor fields through FormData and the shared schema", () => {
    const payload = intakePayloadFromFormData(formDataFrom(fullWireValues()));
    const parsed: ShipmentIntake = shipmentIntakeSchema.parse(payload);

    expect(parsed.cargo_hazard).toEqual({
      cargoDescription: "Boxed consumer electronics",
      hsCode: "8471.30",
      unNumber: "UN1830",
      hazardClass: "none",
    });
    expect(parsed.packing_certs).toEqual({
      packingType: "Double-wall cartons, palletized",
      ispm15CertPresent: true,
      dgCertPresent: false,
      certExpiryDate: "2027-06-30",
    });
    expect(parsed.carrier_record).toEqual({
      carrierId: "car-001",
      carrierName: "Seed Carrier 2",
      carrierSafetyRating: 2,
      carrierClaimsRating: 3,
    });
    expect(parsed.route_lane).toEqual({
      origin: "Chicago, IL",
      destination: "Dallas, TX",
      mode: "road",
      laneId: "US-IL-TX-01",
    });
    expect(parsed.live_conditions).toEqual({
      conditions: ["severe_weather", "port_congestion"],
      notes: "Winter storm advisory",
    });
    expect(parsed.load_type).toEqual({ loadType: "shared", handlingPoints: 3 });
    expect(parsed.value_fragility).toEqual({
      declaredValueUsd: 120000,
      fragilityClass: "medium",
    });
    expect(parsed.sensitivity).toEqual({ delaySensitivity: "jit" });
    expect(parsed.escalation).toEqual({
      escalationExposure: "contained",
      escalationContact: "ops@example.com",
    });
    expect(parsed.coverage).toEqual({
      insuranceCoverageUsd: 150000,
      carrierLiabilityLimitUsd: 100000,
    });
  });

  it("parses an entirely empty submission as a draft of unknowns", () => {
    const payload = intakePayloadFromFormData(formDataFrom({}));
    const parsed = shipmentIntakeSchema.parse(payload);
    expect(parsed.cargo_hazard.cargoDescription).toBeUndefined();
    expect(parsed.coverage.insuranceCoverageUsd).toBeUndefined();
    expect(parsed.live_conditions.conditions).toEqual([]);
  });

  it("treats blank and whitespace-only text as unknown, never as a value", () => {
    const fd = formDataFrom({ "cargo_hazard.cargoDescription": "   " });
    const payload = intakePayloadFromFormData(fd);
    expect(payload).toEqual({});
  });

  it("passes invalid numbers through so the shared schema owns the rejection", () => {
    const fd = formDataFrom({
      "value_fragility.declaredValueUsd": "not-a-number",
    });
    const payload = intakePayloadFromFormData(fd);
    expect(() => shipmentIntakeSchema.parse(payload)).toThrow();
  });

  it("keeps unknown tri-state booleans unknown instead of defaulting to No", () => {
    const fd = formDataFrom({
      "packing_certs.ispm15CertPresent": "",
      "packing_certs.dgCertPresent": "true",
    });
    const parsed = shipmentIntakeSchema.parse(
      intakePayloadFromFormData(fd)
    );
    expect(parsed.packing_certs.ispm15CertPresent).toBeUndefined();
    expect(parsed.packing_certs.dgCertPresent).toBe(true);
  });
});

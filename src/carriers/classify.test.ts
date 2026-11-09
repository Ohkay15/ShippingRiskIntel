import { describe, expect, it } from "vitest";

import { shipmentIntakeSchema, type ShipmentIntake } from "@/schemas/shipment";
import type { MatrixCell } from "@/scoring/engine";

import {
  carrierAcceptsLaneRisk,
  carrierSupportsCargo,
  classifyCargo,
  laneRiskFromCell,
} from "./classify";

function record(patch: Record<string, unknown> = {}): ShipmentIntake {
  return shipmentIntakeSchema.parse(patch);
}

describe("classifyCargo", () => {
  it("classifies an empty record as general dry goods", () => {
    expect(classifyCargo(record())).toEqual(["general_dry"]);
  });

  it("classifies dangerous goods as hazmat", () => {
    const classified = classifyCargo(
      record({ cargo_hazard: { hazardClass: "3" } })
    );
    expect(classified).toEqual(["hazmat"]);
  });

  it("does not classify an unknown hazard class as anything", () => {
    // The record is flagged for review by the engine; matching must not guess
    // "not hazmat" from missing data.
    expect(classifyCargo(record())).toEqual(["general_dry"]);
    expect(classifyCargo(record({ cargo_hazard: { hazardClass: null } }))).toEqual([
      "general_dry",
    ]);
  });

  it("classifies perishable shipments", () => {
    expect(
      classifyCargo(record({ sensitivity: { delaySensitivity: "perishable" } }))
    ).toEqual(["perishable"]);
  });

  it("classifies fragile cargo as high value fragile", () => {
    expect(
      classifyCargo(record({ value_fragility: { fragilityClass: "ultra" } }))
    ).toEqual(["high_value_fragile"]);
  });

  it("accumulates multiple categories for a hazardous perishable shipment", () => {
    const classified = classifyCargo(
      record({
        cargo_hazard: { hazardClass: "8" },
        sensitivity: { delaySensitivity: "perishable" },
      })
    );
    expect(classified).toEqual(["hazmat", "perishable"]);
  });

  it("classifies explicit none as general dry, not hazmat", () => {
    expect(classifyCargo(record({ cargo_hazard: { hazardClass: "none" } }))).toEqual([
      "general_dry",
    ]);
  });
});

describe("laneRiskFromCell", () => {
  it.each<[MatrixCell, "low" | "medium" | "high"]>([
    ["LL", "low"],
    ["LH", "medium"],
    ["HL", "medium"],
    ["HH", "high"],
  ])("maps %s to %s", (cell, expected) => {
    expect(laneRiskFromCell(cell)).toBe(expected);
  });
});

describe("carrierSupportsCargo", () => {
  it("requires every record category to be covered", () => {
    const dryOnly = ["general_dry"] as const;
    expect(carrierSupportsCargo(dryOnly, ["general_dry"])).toBe(true);
    expect(carrierSupportsCargo(dryOnly, ["general_dry", "hazmat"])).toBe(false);
    expect(carrierSupportsCargo(["general_dry", "hazmat"], ["hazmat"])).toBe(true);
  });
});

describe("carrierAcceptsLaneRisk", () => {
  it("accepts lanes at or below the carrier's max tier", () => {
    expect(carrierAcceptsLaneRisk("high", "high")).toBe(true);
    expect(carrierAcceptsLaneRisk("medium", "low")).toBe(true);
    expect(carrierAcceptsLaneRisk("low", "medium")).toBe(false);
  });
});

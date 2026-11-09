import { describe, expect, it } from "vitest";

import { buildDemoDataset } from "@/scoring/demo-seed";
import type { ShipmentIntake } from "@/schemas/shipment";
import { applyRecordEdit, intakeEquals } from "./record-edit";

const CLEAN: ShipmentIntake = buildDemoDataset()[0].intakeData;

function formWith(overrides: Record<string, string | string[]>): FormData {
  const filled = fullWireForm(CLEAN);
  for (const [key, value] of Object.entries(overrides)) {
    if (Array.isArray(value)) {
      value.forEach((v) => filled.append(key, v));
    } else {
      filled.set(key, value);
    }
  }
  return filled;
}

/** Render the clean record back into wire format, every field present. */
function fullWireForm(intake: ShipmentIntake): FormData {
  const formData = new FormData();
  const groups = intake as unknown as Record<string, Record<string, unknown>>;
  for (const [group, fields] of Object.entries(groups)) {
    for (const [leaf, value] of Object.entries(fields)) {
      if (value == null) continue;
      if (Array.isArray(value)) value.forEach((v) => formData.append(`${group}.${leaf}`, String(v)));
      else formData.set(`${group}.${leaf}`, String(value));
    }
  }
  return formData;
}

describe("applyRecordEdit", () => {
  it("accepts a valid full replacement and detects no change when identical", () => {
    const outcome = applyRecordEdit(CLEAN, formWith({}));
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.changed).toBe(false);
    // Semantic equality: the schema makes empty leaves optional, so a
    // form round-trip omits keys the stored record carries as explicit
    // nulls. intakeEquals is the documented "unknown = unknown" comparison.
    expect(intakeEquals(CLEAN, outcome.intake)).toBe(true);
  });

  it("detects a one-field change", () => {
    const outcome = applyRecordEdit(
      CLEAN,
      formWith({ "cargo_hazard.cargoDescription": "Palletized laptops, 12 units" })
    );
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.changed).toBe(true);
    expect(outcome.intake.cargo_hazard.cargoDescription).toBe(
      "Palletized laptops, 12 units"
    );
  });

  it("clears a field to unknown when the operator empties it", () => {
    // CLEAN carries a description but no UN number — clear the field that
    // actually holds data (clearing an already-unknown field is a no-op).
    const outcome = applyRecordEdit(CLEAN, formWith({ "cargo_hazard.cargoDescription": "" }));
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.changed).toBe(true);
    // Schema leaves are optional — an emptied field reads back as
    // null-or-undefined, which the canonicalizer treats as the same unknown.
    expect(outcome.intake.cargo_hazard.cargoDescription ?? null).toBeNull();
  });

  it("rejects invalid values with field-level errors on the wire path", () => {
    const outcome = applyRecordEdit(CLEAN, formWith({ "cargo_hazard.unNumber": "NOT-UN" }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.fieldErrors["cargo_hazard.unNumber"]).toBeTruthy();
    expect(outcome.message).toContain("invalid");
  });

  it("rejects impossible dollar values instead of silently clamping", () => {
    const outcome = applyRecordEdit(
      CLEAN,
      formWith({ "coverage.insuranceCoverageUsd": "-500" })
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("intakeEquals", () => {
  it("is false for a one-character description difference", () => {
    const edited = {
      ...CLEAN,
      cargo_hazard: {
        ...CLEAN.cargo_hazard,
        cargoDescription: `${CLEAN.cargo_hazard.cargoDescription}x`,
      },
    } as ShipmentIntake;
    expect(intakeEquals(CLEAN, edited)).toBe(false);
  });

  it("is true for structurally identical intakes", () => {
    expect(intakeEquals(CLEAN, CLEAN)).toBe(true);
  });
});

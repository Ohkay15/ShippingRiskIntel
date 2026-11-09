import { describe, expect, it } from "vitest";

import { GARBLED_DOCUMENT, SAMPLE_COMMERCIAL_INVOICE } from "@/llm/fixtures";
import { MockLlmClient } from "@/llm/mock-provider";
import type { ExtractedField } from "@/llm/extraction-schema";
import { extractionFieldEntries, type ExtractionResult } from "@/llm/extraction-schema";
import { shipmentIntakeSchema } from "@/schemas/shipment";

import { applyConfidenceGate, CONFIDENCE_THRESHOLD, mergeExtractions, mergeIntake } from "./gate";

function resultWithField(
  path: string,
  field: Partial<ExtractedField>
): ExtractionResult {
  const [group, leaf] = path.split(".");
  const entry = { value: "x", confidence: 0.95, evidence: "quote", ...field };
  // Build the nested shape the schema expects, then type-erase — tests
  // construct targeted leaves, not full documents.
  const nested: Record<string, Record<string, unknown>> = {
    [group as string]: { [leaf as string]: entry },
  };
  return nested as unknown as ExtractionResult;
}

/** Run the mock against text, then gate it. */
function gatedFromText(text: string) {
  const client = new MockLlmClient();
  return client
    .extractShipment({ kind: "commercial_invoice", text })
    .then((r) => applyConfidenceGate(r));
}

describe("applyConfidenceGate", () => {
  it("keeps a field at exactly the threshold", () => {
    const gated = applyConfidenceGate(
      resultWithField("cargo_hazard.cargoDescription", {
        value: "Copper cathode",
        confidence: CONFIDENCE_THRESHOLD,
      })
    );
    expect(gated.intake.cargo_hazard.cargoDescription).toBe("Copper cathode");
    expect(gated.needsReview).toBe(true); // other fields still missing
    expect(gated.flaggedFields.map((f) => f.path)).not.toContain(
      "cargo_hazard.cargoDescription"
    );
  });

  it("nulls a below-threshold field and flags it with evidence", () => {
    const gated = applyConfidenceGate(
      resultWithField("cargo_hazard.cargoDescription", {
        value: "Maybe pallets??",
        confidence: 0.5,
        evidence: "possibly pallets",
      })
    );
    expect(gated.intake.cargo_hazard.cargoDescription).toBeUndefined();
    const flag = gated.flaggedFields.find(
      (f) => f.path === "cargo_hazard.cargoDescription"
    );
    expect(flag?.reason).toBe("low_confidence");
    expect(flag?.confidence).toBe(0.5);
    expect(flag?.evidence).toBe("possibly pallets");
    expect(gated.needsReview).toBe(true);
  });

  it("flags an absent field as missing rather than guessing", () => {
    const gated = applyConfidenceGate(
      resultWithField("cargo_hazard.cargoDescription", {
        value: null,
        confidence: 0,
      })
    );
    const flag = gated.flaggedFields.find(
      (f) => f.path === "cargo_hazard.cargoDescription"
    );
    expect(flag?.reason).toBe("missing");
    expect(gated.intake.cargo_hazard.cargoDescription).toBeUndefined();
  });

  it("rejects a high-confidence value that violates the intake contract", () => {
    const gated = applyConfidenceGate(
      resultWithField("cargo_hazard.hazardClass", {
        value: "class_four_and_a_half",
        confidence: 0.95,
      })
    );
    expect(gated.intake.cargo_hazard.hazardClass).toBeUndefined();
    const flag = gated.flaggedFields.find(
      (f) => f.path === "cargo_hazard.hazardClass"
    );
    expect(flag?.reason).toBe("invalid_value");
  });

  it("is deterministic", async () => {
    const client = new MockLlmClient();
    const [a, b] = await Promise.all([
      client
        .extractShipment({ kind: "commercial_invoice", text: SAMPLE_COMMERCIAL_INVOICE })
        .then((r) => applyConfidenceGate(r)),
      client
        .extractShipment({ kind: "commercial_invoice", text: SAMPLE_COMMERCIAL_INVOICE })
        .then((r) => applyConfidenceGate(r)),
    ]);
    expect(b).toEqual(a);
  });

  it("routes a garbled document to Needs review with zero guessed values", async () => {
    const client = new MockLlmClient();
    const raw = await client.extractShipment({
      kind: "commercial_invoice",
      text: GARBLED_DOCUMENT,
    });
    const gated = applyConfidenceGate(raw);
    expect(gated.needsReview).toBe(true);
    // Nothing anywhere in the intake was invented: every field flagged,
    // so every intake leaf is absent or an empty default.
    for (const { path } of extractionFieldEntries(raw)) {
      const [group, leaf] = path.split(".");
      const groupData = gated.intake[group as keyof typeof gated.intake];
      const value = (groupData as Record<string, unknown>)[leaf as string];
      const meaningful = value != null && !(Array.isArray(value) && value.length === 0);
      expect(meaningful, `expected no value at ${path}, found ${JSON.stringify(value)}`).toBe(false);
    }
    expect(gated.flaggedFields.length).toBe(extractionFieldEntries(raw).length);
  });

  it("passes every extracted field of a clean invoice and routes to review only for gaps", async () => {
    const gated = await gatedFromText(SAMPLE_COMMERCIAL_INVOICE);
    expect(gated.intake.cargo_hazard.cargoDescription).toBe(
      "Boxed consumer electronics"
    );
    expect(gated.intake.value_fragility.declaredValueUsd).toBe(120000);
    expect(gated.intake.coverage.carrierLiabilityLimitUsd).toBe(100000);
    // The invoice genuinely lacks a UN number → that is a missing field,
    // not a guess. Needs review stays true for those gaps only.
    const missing = gated.flaggedFields.filter((f) => f.reason === "missing");
    expect(missing.map((f) => f.path)).toContain("cargo_hazard.unNumber");
    const lowConfidence = gated.flaggedFields.filter(
      (f) => f.reason === "low_confidence"
    );
    expect(lowConfidence).toEqual([]);
  });
});

describe("mergeExtractions", () => {
  it("prefers the higher-confidence value per field", () => {
    const low = resultWithField("value_fragility.declaredValueUsd", {
      value: 90000,
      confidence: 0.5,
    });
    const high = resultWithField("value_fragility.declaredValueUsd", {
      value: 120000,
      confidence: 0.9,
    });
    const merged = mergeExtractions([low, high]);
    const entries = merged
      ? extractionFieldEntries(merged).filter(
          (f) => f.path === "value_fragility.declaredValueUsd"
        )
      : [];
    expect(entries[0]?.field.value).toBe(120000);
  });

  it("returns null for an empty merge", () => {
    expect(mergeExtractions([])).toBeNull();
  });
});

describe("mergeIntake", () => {
  it("fills an unknown slot from extraction", () => {
    const existing = shipmentIntakeSchema.parse({});
    const extracted = shipmentIntakeSchema.parse({
      cargo_hazard: { cargoDescription: "Copper cathode" },
    });
    const merged = mergeIntake(existing, extracted);
    expect(merged.cargo_hazard.cargoDescription).toBe("Copper cathode");
  });

  it("never clobbers a value the operator already set", () => {
    const existing = shipmentIntakeSchema.parse({
      cargo_hazard: { cargoDescription: "Operator entered this" },
    });
    const extracted = shipmentIntakeSchema.parse({
      cargo_hazard: { cargoDescription: "From the document" },
    });
    const merged = mergeIntake(existing, extracted);
    expect(merged.cargo_hazard.cargoDescription).toBe("Operator entered this");
  });

  it("keeps the existing value when extraction is unknown", () => {
    const existing = shipmentIntakeSchema.parse({
      value_fragility: { declaredValueUsd: 50000 },
    });
    const extracted = shipmentIntakeSchema.parse({});
    const merged = mergeIntake(existing, extracted);
    expect(merged.value_fragility.declaredValueUsd).toBe(50000);
  });

  it("treats an empty conditions list as unknown, not a wipe", () => {
    const existing = shipmentIntakeSchema.parse({
      live_conditions: { conditions: ["severe_weather"] },
    });
    const extracted = shipmentIntakeSchema.parse({
      live_conditions: { conditions: [] },
    });
    const merged = mergeIntake(existing, extracted);
    expect(merged.live_conditions.conditions).toEqual(["severe_weather"]);
  });
});

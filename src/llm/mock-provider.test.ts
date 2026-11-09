import { describe, expect, it } from "vitest";

import { extractionFieldEntries, extractionResultSchema } from "./extraction-schema";
import { GARBLED_DOCUMENT, SAMPLE_COMMERCIAL_INVOICE } from "./fixtures";
import { MockLlmClient } from "./mock-provider";
import type { ExtractedField } from "./extraction-schema";

function extract(
  text: string
): Promise<{ path: string; field: ExtractedField }[]> {
  const client = new MockLlmClient();
  return client
    .extractShipment({ kind: "commercial_invoice", text })
    .then(extractionFieldEntries);
}

describe("MockLlmClient", () => {
  it("extracts labeled fields with confidence and verbatim evidence", async () => {
    const fields = await extract(SAMPLE_COMMERCIAL_INVOICE);
    const byPath = Object.fromEntries(fields.map((f) => [f.path, f.field]));

    expect(byPath["cargo_hazard.cargoDescription"].value).toBe(
      "Boxed consumer electronics"
    );
    expect(byPath["cargo_hazard.cargoDescription"].confidence).toBeGreaterThanOrEqual(0.9);
    expect(byPath["cargo_hazard.cargoDescription"].evidence.toLowerCase()).toContain(
      "cargo description"
    );
    expect(byPath["value_fragility.declaredValueUsd"].value).toBe(120000);
    expect(byPath["coverage.carrierLiabilityLimitUsd"].value).toBe(100000);
    expect(byPath["packing_certs.ispm15CertPresent"].value).toBe(true);
    expect(byPath["packing_certs.dgCertPresent"].value).toBe(false);
    expect(byPath["load_type.loadType"].value).toBe("sealed_dedicated");
    expect(byPath["live_conditions.conditions"].value).toEqual(["none_reported"]);
  });

  it("returns null with evidence for fields the document does not contain", async () => {
    const fields = await extract(SAMPLE_COMMERCIAL_INVOICE);
    const unNumber = fields.find(
      (f) => f.path === "cargo_hazard.unNumber"
    )?.field;
    expect(unNumber?.value).toBeNull();
    expect(unNumber?.evidence).toBeTruthy();
  });

  it("is deterministic: identical input yields identical output", async () => {
    const first = await extract(SAMPLE_COMMERCIAL_INVOICE);
    const second = await extract(SAMPLE_COMMERCIAL_INVOICE);
    expect(second).toEqual(first);
  });

  it("finds nothing trustworthy in a garbled document", async () => {
    const fields = await extract(GARBLED_DOCUMENT);
    const withValues = fields.filter((f) => f.field.value !== null);
    expect(withValues).toEqual([]);
    // Every field reports null with a documented reason — not a guess.
    for (const { field } of fields) {
      expect(field.confidence).toBeLessThan(0.75);
      expect(field.evidence).toBeTruthy();
    }
  });
});

describe("extractionResultSchema", () => {
  it("validates a well-formed provider response", async () => {
    const client = new MockLlmClient();
    const raw = await client.extractShipment({
      kind: "commercial_invoice",
      text: SAMPLE_COMMERCIAL_INVOICE,
    });
    const parsed = extractionResultSchema.parse(raw);
    expect(parsed.value_fragility.declaredValueUsd.value).toBe(120000);
    expect(parsed.value_fragility.declaredValueUsd.evidence).toBeTruthy();
  });

  it("rejects confidence outside 0..1", () => {
    expect(() =>
      extractionResultSchema.parse({
        cargo_hazard: {
          cargoDescription: { value: "x", confidence: 1.5, evidence: "q" },
        },
      })
    ).toThrow();
  });

  it("rejects a field with no evidence", () => {
    expect(() =>
      extractionResultSchema.parse({
        cargo_hazard: {
          cargoDescription: { value: "x", confidence: 0.9, evidence: "" },
        },
      })
    ).toThrow();
  });

  it("rejects a non-numeric value for a number field", () => {
    expect(() =>
      extractionResultSchema.parse({
        value_fragility: {
          declaredValueUsd: { value: "120000", confidence: 0.9, evidence: "q" },
        },
      })
    ).toThrow();
  });
});

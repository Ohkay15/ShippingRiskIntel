import { describe, expect, it } from "vitest";

import { PLACEHOLDER_INSURER_FIT_MATRIX } from "./matrix-data";
import { insurerFitMatrixSchema } from "./schema";

describe("PLACEHOLDER_INSURER_FIT_MATRIX", () => {
  it("parses against the insurer fit matrix contract at import", () => {
    expect(() => insurerFitMatrixSchema.parse(PLACEHOLDER_INSURER_FIT_MATRIX)).not.toThrow();
  });

  it("is labeled as a placeholder seed the owner must replace", () => {
    expect(PLACEHOLDER_INSURER_FIT_MATRIX.sourceLabel.toLowerCase()).toContain("placeholder");
  });

  it("has unique product ids — the Actioned transition stores them", () => {
    const ids = PLACEHOLDER_INSURER_FIT_MATRIX.products.map((product) => product.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("spans every cargo category so any record has a matching product", () => {
    const covered = new Set(
      PLACEHOLDER_INSURER_FIT_MATRIX.products.flatMap((product) => product.supportedCargoTypes)
    );
    expect([...covered]).toEqual(
      expect.arrayContaining(["general_dry", "hazmat", "perishable", "high_value_fragile"])
    );
  });
});

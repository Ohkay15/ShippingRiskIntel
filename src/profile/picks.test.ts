import { describe, expect, it } from "vitest";

import { actionedPickInputs, pickSelectionError, picksFromFormValues } from "./picks";

/**
 * Tests for the combined-pick wiring: checkbox form values parse into a
 * selection, invalid selections are refused, and a valid selection maps
 * onto the markActioned transition inputs.
 */

describe("picksFromFormValues", () => {
  it("splits prefixed checkbox values into carrier and insurance ids", () => {
    const picked = picksFromFormValues(["carrier:odfl", "insurance:chubb-marine"]);
    expect(picked).toEqual({
      carrierIds: ["odfl"],
      insuranceIds: ["chubb-marine"],
    });
  });

  it("parses each prefix independently — including a combined both-picks selection", () => {
    expect(picksFromFormValues(["carrier:a"])).toEqual({ carrierIds: ["a"], insuranceIds: [] });
    expect(picksFromFormValues(["insurance:b"])).toEqual({ carrierIds: [], insuranceIds: ["b"] });
  });

  it("ignores values that match no known prefix rather than guessing", () => {
    expect(picksFromFormValues(["carrier:", "junk", "insurance:ok"])).toEqual({
      carrierIds: [""],
      insuranceIds: ["ok"],
    });
    expect(picksFromFormValues([])).toEqual({ carrierIds: [], insuranceIds: [] });
  });
});

describe("pickSelectionError", () => {
  it("refuses an empty selection", () => {
    expect(
      pickSelectionError({ carrierIds: [], insuranceIds: [] })
    ).toContain("Select at least one");
  });

  it("refuses more than one pick per matrix", () => {
    expect(
      pickSelectionError({ carrierIds: ["a", "b"], insuranceIds: [] })
    ).toContain("Only one carrier");
    expect(
      pickSelectionError({ carrierIds: [], insuranceIds: ["a", "b"] })
    ).toContain("Only one insurance product");
  });

  it("accepts one carrier, one product, or one of each", () => {
    expect(pickSelectionError({ carrierIds: ["a"], insuranceIds: [] })).toBeNull();
    expect(pickSelectionError({ carrierIds: [], insuranceIds: ["b"] })).toBeNull();
    expect(pickSelectionError({ carrierIds: ["a"], insuranceIds: ["b"] })).toBeNull();
  });
});

describe("actionedPickInputs", () => {
  it("maps a combined selection onto both markActioned inputs", () => {
    expect(actionedPickInputs({ carrierIds: ["odfl"], insuranceIds: ["chubb-marine"] })).toEqual({
      carrierRecommendationId: "odfl",
      insuranceProductId: "chubb-marine",
    });
  });

  it("maps a single-side selection with a null on the other layer", () => {
    expect(actionedPickInputs({ carrierIds: ["odfl"], insuranceIds: [] })).toEqual({
      carrierRecommendationId: "odfl",
      insuranceProductId: null,
    });
    expect(actionedPickInputs({ carrierIds: [], insuranceIds: ["chubb-marine"] })).toEqual({
      carrierRecommendationId: null,
      insuranceProductId: "chubb-marine",
    });
  });
});

import { describe, expect, it } from "vitest";

import { actionedPickInputs, pickSelectionError, picksFromFormValues } from "./picks";

/**
 * Tests for the combined-pick wiring: checkbox form values parse into a
 * selection, invalid selections are refused, and a valid selection maps
 * onto the markActioned transition inputs.
 */

describe("picksFromFormValues", () => {
  it("splits prefixed checkbox values into carrier and insurance ids", () => {
    const picked = picksFromFormValues(["carrier:carrier-a", "insurance:insurer-a-marine"]);
    expect(picked).toEqual({
      carrierIds: ["carrier-a"],
      insuranceIds: ["insurer-a-marine"],
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
    expect(actionedPickInputs({ carrierIds: ["carrier-a"], insuranceIds: ["insurer-a-marine"] })).toEqual({
      carrierRecommendationId: "carrier-a",
      insuranceProductId: "insurer-a-marine",
    });
  });

  it("maps a single-side selection with a null on the other layer", () => {
    expect(actionedPickInputs({ carrierIds: ["carrier-a"], insuranceIds: [] })).toEqual({
      carrierRecommendationId: "carrier-a",
      insuranceProductId: null,
    });
    expect(actionedPickInputs({ carrierIds: [], insuranceIds: ["insurer-a-marine"] })).toEqual({
      carrierRecommendationId: null,
      insuranceProductId: "insurer-a-marine",
    });
  });
});

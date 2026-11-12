import { describe, expect, it } from "vitest";

import { liveConditionValues, loadTypeSchema, delaySensitivitySchema, HAZARD_CLASS_VALUES } from "@/schemas/shipment";

import { optionLabel } from "./option-labels";

describe("option labels", () => {
  it("never shows a raw code to people", () => {
    const codes = [...liveConditionValues, ...loadTypeSchema.options, ...delaySensitivitySchema.options, ...HAZARD_CLASS_VALUES];
    for (const code of codes) expect(optionLabel(code)).not.toMatch(/_/);
    expect(optionLabel("jit")).toBe("Just-in-time");
    expect(optionLabel("sealed_dedicated")).toBe("Sealed, dedicated truck");
    expect(optionLabel("something_new")).toBe("Something new");
  });
});

import { describe, expect, it } from "vitest";

import {
  coverageGapCell,
  coverageGapView,
  formatUsd,
} from "./display";

describe("coverageGapView", () => {
  it("leads with the exposed dollar amount when the gap is positive", () => {
    const view = coverageGapView(27000, 90000, 63000);
    expect(view.state).toBe("under_covered");
    expect(view.tone).toBe("danger");
    expect(view.headline).toBe("$27,000 uncovered");
    expect(view.detail).toContain("$90,000 declared value");
    expect(view.detail).toContain("$63,000");
  });

  it("shows a negative surplus as fully covered with the surplus restated positive", () => {
    const view = coverageGapView(-60000, 90000, 150000);
    if (view.state !== "fully_covered") throw new Error("expected a fully_covered view");
    expect(view.surplusUsd).toBe(60000);
    expect(view.tone).toBe("ok");
    expect(view.headline).toBe("Fully covered");
    // Never a negative "gap" in prose.
    expect(view.headline).not.toContain("-$60,000");
    expect(view.detail).toContain("$60,000");
  });

  it("shows an exact zero gap as fully covered with no buffer, never a $0 gap", () => {
    const view = coverageGapView(0, 90000, 90000);
    if (view.state !== "fully_covered") throw new Error("expected a fully_covered view");
    expect(view.surplusUsd).toBe(0);
    expect(view.headline).toBe("Fully covered");
    expect(view.detail).toContain("exactly meets");
    expect(view.headline).not.toContain("$0");
  });

  it("shows absent coverage data as unknown — never $0", () => {
    const view = coverageGapView(null, 90000, null);
    expect(view.state).toBe("unknown");
    expect(view.tone).toBe("warning");
    expect(view.headline).toBe("Coverage unknown");
    expect(view.headline).not.toContain("$0");
    expect(JSON.stringify(view)).not.toContain("$0");
  });

  it("formats fractional dollar amounts to the cent", () => {
    expect(formatUsd(1000.5)).toBe("$1,000.50");
    expect(formatUsd(1000)).toBe("$1,000");
  });
});

describe("coverageGapCell (list compact rendering)", () => {
  it("renders each state compactly", () => {
    expect(coverageGapCell(coverageGapView(27000, 90000, 63000))).toBe("$27,000 uncovered");
    expect(coverageGapCell(coverageGapView(-60000, 90000, 150000))).toBe(
      "Covered · $60,000 surplus"
    );
    expect(coverageGapCell(coverageGapView(0, 90000, 90000))).toBe("Covered · exact");
    expect(coverageGapCell(coverageGapView(null, 90000, null))).toBe("Unknown");
  });
});

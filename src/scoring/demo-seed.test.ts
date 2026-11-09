import { describe, expect, it } from "vitest";

import { buildDemoDataset, demoShipmentUuid } from "./demo-seed";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("buildDemoDataset", () => {
  it("produces one row per synthetic scenario with unique valid fixed UUIDs", () => {
    const rows = buildDemoDataset();
    expect(rows).toHaveLength(40);
    const ids = new Set(rows.map((row) => row.id));
    expect(ids.size).toBe(40);
    for (const id of ids) {
      expect(id).toMatch(UUID_PATTERN);
    }
    expect(demoShipmentUuid("SH-001")).toBe(
      "00000000-0000-4000-8000-000000000001"
    );
  });

  it("routes records with review flags to needs_review and the rest to scored", () => {
    const rows = buildDemoDataset();
    const flagged = rows.filter((row) => row.profile.needsReview);
    expect(flagged).toHaveLength(2);
    for (const row of flagged) {
      expect(row.status).toBe("needs_review");
      expect(row.profile.reviewFlags.map((flag) => flag.factor)).toContain(
        "coverage"
      );
    }
    expect(rows.filter((row) => row.status === "scored")).toHaveLength(38);
  });

  it("is deterministic — same build, identical rows", () => {
    expect(JSON.stringify(buildDemoDataset())).toBe(
      JSON.stringify(buildDemoDataset())
    );
  });

  it("stamps stable ascending timestamps for stable list ordering", () => {
    const rows = buildDemoDataset();
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].createdAt.getTime()).toBeGreaterThan(
        rows[i - 1].createdAt.getTime()
      );
    }
    for (const row of rows) {
      expect(row.scoredAt.getTime()).toBeGreaterThanOrEqual(
        row.createdAt.getTime()
      );
    }
  });
});

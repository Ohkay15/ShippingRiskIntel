import { describe, expect, it } from "vitest";

import type { RiskProfile } from "../scoring/engine";
import {
  parseSortParams,
  sortShipmentRows,
  type ShipmentListRow,
} from "./list-rows";

function row(
  id: string,
  overrides: Partial<ShipmentListRow> & { profileScore?: number; gap?: number | null } = {}
): ShipmentListRow {
  const { profileScore, gap, ...rest } = overrides;
  const profile =
    profileScore === undefined
      ? null
      : ({
          score: profileScore,
          // null is meaningful here (unknown gap) — only undefined means "omit".
          coverageGapUsd: gap !== undefined ? gap : 0,
        } as RiskProfile);
  return {
    id,
    status: "scored",
    profile,
    updatedAt: new Date(Date.parse("2026-11-01T09:00:00Z")),
    ...rest,
  };
}

describe("parseSortParams", () => {
  it("whitelists sort keys and directions, defaulting to score desc", () => {
    expect(parseSortParams(undefined, undefined)).toEqual({ key: "score", direction: "desc" });
    expect(parseSortParams("gap", "asc")).toEqual({ key: "gap", direction: "asc" });
    expect(parseSortParams("injected;--", "desc")).toEqual({ key: "score", direction: "desc" });
    expect(parseSortParams("score", "sideways")).toEqual({ key: "score", direction: "desc" });
  });
});

describe("sortShipmentRows", () => {
  const rows = [
    row("b", { profileScore: 7.2, gap: 27000 }),
    row("a", { profileScore: 13.06, gap: -60000 }),
    row("c", { profileScore: 2.18, gap: null }),
    row("d", { status: "draft" }), // no profile — drafts are unscored
  ];

  it("sorts by score desc with unscored records last", () => {
    const ids = sortShipmentRows(rows, "score", "desc").map((r) => r.id);
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });

  it("sorts by score asc with unscored records still last", () => {
    const ids = sortShipmentRows(rows, "score", "asc").map((r) => r.id);
    expect(ids).toEqual(["c", "b", "a", "d"]);
  });

  it("sorts by coverage gap desc: biggest exposure first, unknown last", () => {
    const ids = sortShipmentRows(rows, "gap", "desc").map((r) => r.id);
    expect(ids).toEqual(["b", "a", "c", "d"]);
  });

  it("treats an unknown gap as its own bucket after computable gaps, asc too", () => {
    const ids = sortShipmentRows(rows, "gap", "asc").map((r) => r.id);
    // asc: covered (-60000) then under-covered (27000); unknown (c) last.
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });

  it("sorts by updated time", () => {
    const stamped = [
      row("x", { updatedAt: new Date(100) }),
      row("y", { updatedAt: new Date(300) }),
      row("z", { updatedAt: new Date(200) }),
    ];
    expect(sortShipmentRows(stamped, "updated", "asc").map((r) => r.id)).toEqual(["x", "z", "y"]);
    expect(sortShipmentRows(stamped, "updated", "desc").map((r) => r.id)).toEqual(["y", "z", "x"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...rows];
    sortShipmentRows(rows, "score", "asc");
    expect(rows).toEqual(copy);
  });
});

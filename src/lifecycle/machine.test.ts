import { describe, expect, it } from "vitest";

import type { ShipmentStatus } from "@/db/lifecycle";
import {
  STATUS_TRANSITIONS,
  canConfirmRecord,
  canEditRecord,
  canResolveReview,
  canTransition,
  editRefusalMessage,
} from "./machine";

const ALL = STATUS_TRANSITIONS as Readonly<
  Record<ShipmentStatus, readonly ShipmentStatus[]>
>;

describe("STATUS_TRANSITIONS", () => {
  it("covers every lifecycle status as a key", () => {
    expect(Object.keys(ALL).sort()).toEqual(
      ["actioned", "draft", "extracting", "needs_review", "scored"].sort()
    );
  });

  it("never allows a transition out of actioned except reopen", () => {
    expect(ALL.actioned).toEqual(["draft"]);
  });

  it("lets drafts exit only by confirm (extraction) or the scoring gateway", () => {
    expect(ALL.draft).toEqual(["extracting", "needs_review", "scored"]);
  });

  it("keeps a still-flagged re-score legal from needs_review", () => {
    expect(canTransition("needs_review", "needs_review")).toBe(true);
  });
});

describe("canTransition", () => {
  it("allows each mapped edge", () => {
    for (const [from, targets] of Object.entries(ALL)) {
      for (const to of targets) {
        expect(canTransition(from as ShipmentStatus, to), `${from} → ${to}`).toBe(
          true
        );
      }
    }
  });

  it("refuses edges the map does not contain", () => {
    for (const [from, targets] of Object.entries(ALL)) {
      for (const status of Object.keys(ALL) as ShipmentStatus[]) {
        if (!targets.includes(status)) {
          expect(
            canTransition(from as ShipmentStatus, status),
            `${from} → ${status}`
          ).toBe(false);
        }
      }
    }
  });

  it("blocks actioned from a draft record — the invariant the demo depends on", () => {
    expect(canTransition("draft", "actioned")).toBe(false);
    expect(canTransition("extracting", "actioned")).toBe(false);
    expect(canTransition("needs_review", "actioned")).toBe(false);
    expect(canTransition("scored", "actioned")).toBe(true);
  });
});

describe("guard predicates", () => {
  it("confirm is draft-only", () => {
    expect(canConfirmRecord("draft")).toBe(true);
    expect(canConfirmRecord("scored")).toBe(false);
    expect(canConfirmRecord("extracting")).toBe(false);
  });

  it("edit is refused on actioned and mid-extraction records", () => {
    expect(canEditRecord("draft")).toBe(true);
    expect(canEditRecord("needs_review")).toBe(true);
    expect(canEditRecord("scored")).toBe(true);
    expect(canEditRecord("actioned")).toBe(false);
    expect(canEditRecord("extracting")).toBe(false);
  });

  it("review resolution is needs_review-only", () => {
    expect(canResolveReview("needs_review")).toBe(true);
    expect(canResolveReview("scored")).toBe(false);
  });

  it("explains every edit refusal", () => {
    expect(editRefusalMessage("actioned")).toContain("actioned");
    expect(editRefusalMessage("extracting")).toContain("Extraction");
  });
});

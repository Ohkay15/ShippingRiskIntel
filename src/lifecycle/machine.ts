import type { ShipmentStatus } from "@/db/lifecycle";

/**
 * The record lifecycle as data (spec §Lifecycle): Draft → Extracting →
 * Needs review → Scored → Actioned. Every status guard in the app routes
 * through these pure predicates — a transition cannot be invented at a
 * call site, and the map is the single testable source of truth.
 *
 * Notes on the edges:
 * - Draft exits three ways: confirm-with-documents → Extracting; a
 *   document-less confirm goes straight through the scoring gateway to
 *   Scored/Needs review. Uploads never auto-score.
 * - Extracting can be cancelled back to Draft (PR #2's cancel action).
 * - Scored loops in place (idempotent re-score) or returns to Needs
 *   review when a fresh score flags unknowns; editing demotes to Draft.
 * - Actioned reopens to Draft (spec state table) — the reopen action is
 *   not wired in the MVP UI.
 */
export const STATUS_TRANSITIONS: Readonly<
  Record<ShipmentStatus, readonly ShipmentStatus[]>
> = {
  draft: ["extracting", "needs_review", "scored"],
  extracting: ["draft", "needs_review", "scored"],
  needs_review: ["needs_review", "scored"],
  scored: ["draft", "needs_review", "scored", "actioned"],
  actioned: ["draft"],
};

export function canTransition(
  from: ShipmentStatus,
  to: ShipmentStatus
): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

/** Only draft records confirm — into extraction or straight into scoring. */
export function canConfirmRecord(status: ShipmentStatus): boolean {
  return status === "draft";
}

/** Actioned records are locked and mid-extraction records are in flight. */
export function canEditRecord(status: ShipmentStatus): boolean {
  return status !== "actioned" && status !== "extracting";
}

/** Only the review queue's own records resolve there. */
export function canResolveReview(status: ShipmentStatus): boolean {
  return status === "needs_review";
}

/** Why a record refuses edits, for the action's error message. */
export function editRefusalMessage(status: ShipmentStatus): string {
  if (status === "actioned") {
    return "This record is actioned (carrier selected) and locked. Reopen it before editing.";
  }
  if (status === "extracting") {
    return "Extraction is in progress for this record. Wait for it to finish or cancel it first.";
  }
  return `Record is ${status}; it cannot be edited right now.`;
}

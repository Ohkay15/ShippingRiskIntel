import type { MatrixCell, RiskProfile } from "../scoring/engine";
import type { ShipmentStatus } from "../db/lifecycle";

/**
 * Pure client-side-free sorting for the shipments list. Sorting happens in
 * the page over the loaded rows (pilot volumes are hundreds of records) —
 * this module owns the comparator so the ordering rules are testable.
 *
 * Records without a profile (draft, extracting) and without a computable
 * gap always sort AFTER records that have one, in either direction: a
 * not-yet-scored record must never hide between scored ones just because
 * the operator toggled a column.
 */

export type ShipmentListRow = {
  id: string;
  status: ShipmentStatus;
  profile: RiskProfile | null;
  updatedAt: Date;
};

export const SHIPMENT_SORT_KEYS = ["score", "gap", "updated"] as const;
export type ShipmentSortKey = (typeof SHIPMENT_SORT_KEYS)[number];
export type SortDirection = "asc" | "desc";

export function parseSortParams(
  sort: string | undefined,
  dir: string | undefined
): { key: ShipmentSortKey; direction: SortDirection } {
  const key = SHIPMENT_SORT_KEYS.find((candidate) => candidate === sort);
  const direction = dir === "asc" || dir === "desc" ? dir : "desc";
  return { key: key ?? "score", direction };
}

function profileShown(status: ShipmentStatus, profile: RiskProfile | null): boolean {
  return profile != null && (status === "scored" || status === "needs_review");
}

export function sortShipmentRows(
  rows: ShipmentListRow[],
  key: ShipmentSortKey,
  direction: SortDirection
): ShipmentListRow[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "updated") {
      return (a.updatedAt.getTime() - b.updatedAt.getTime()) * factor || byId(a, b);
    }

    const aHas = profileShown(a.status, a.profile);
    const bHas = profileShown(b.status, b.profile);
    if (aHas !== bHas) {
      // Missing profile sorts last regardless of direction.
      return aHas ? -1 : 1;
    }
    if (!aHas || !bHas || !a.profile || !b.profile) {
      return byId(a, b);
    }

    if (key === "score") {
      return ((a.profile.score - b.profile.score) * factor || byId(a, b));
    }

    const aGap = a.profile.coverageGapUsd;
    const bGap = b.profile.coverageGapUsd;
    // Unknown gap (null) sorts after a computable gap in either direction —
    // "unknown exposure" is its own bucket, not a zero.
    if (aGap == null && bGap == null) return byId(a, b);
    if (aGap == null) return 1;
    if (bGap == null) return -1;
    return (aGap - bGap) * factor || byId(a, b);
  });
}

function byId(a: ShipmentListRow, b: ShipmentListRow): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Ordered high→low for display in the matrix legend. */
export const MATRIX_CELL_ORDER: readonly MatrixCell[] = ["LL", "LH", "HL", "HH"];

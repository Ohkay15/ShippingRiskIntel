import type { MatrixCell } from "../scoring/engine";

/**
 * How a stored coverage gap is DISPLAYED — the presentation contract for the
 * spec's lead metric. The engine keeps the raw signed gap (declared value −
 * effective coverage, negative when fully covered); this module decides what
 * the operator reads, and it is deliberately a discriminated union so a
 * rendering component cannot print a misleading number:
 *
 * - gap > 0  → the number leads: "$27,000 uncovered" (danger).
 * - gap < 0  → fully covered: the surplus is stated as a positive amount
 *              ("coverage exceeds declared value by $60,000"), never shown
 *              as a negative "gap".
 * - gap == 0 → fully covered, exactly: coverage meets the value with no
 *              buffer. Stated plainly — never rendered as a "$0 gap", which
 *              would read as "gap computed, nothing exposed" for a shipment
 *              whose coverage could evaporate with any value change.
 * - null     → coverage data is absent: "Coverage unknown" (warning). A
 *              missing-coverage record showing $0 would read as fully
 *              covered — the single worst silent failure this product could
 *              ship (spec acceptance table), so unknown is its own state.
 */

export type CoverageGapView =
  | {
      state: "under_covered";
      /** The exposed dollar amount — the lead number. */
      gapUsd: number;
      headline: string;
      detail: string;
      tone: "danger";
    }
  | {
      state: "fully_covered";
      /** How much coverage exceeds the declared value; 0 when exact. */
      surplusUsd: number;
      headline: string;
      detail: string;
      tone: "ok";
    }
  | {
      state: "unknown";
      headline: string;
      detail: string;
      tone: "warning";
    };

/** Deterministic en-US/USD formatting — server and client render identically. */
export function formatUsd(usd: number): string {
  const hasCents = Math.round(usd * 100) % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(usd);
}

export function coverageGapView(
  gapUsd: number | null,
  declaredValueUsd: number | null,
  effectiveCoverage: number | null
): CoverageGapView {
  if (gapUsd == null) {
    return {
      state: "unknown",
      headline: "Coverage unknown",
      detail:
        "No coverage data is on file for this record, so the gap between " +
        "declared value and coverage cannot be computed. Enter coverage " +
        "terms to see the real exposure — absence of data is never treated " +
        "as fully covered.",
      tone: "warning",
    };
  }

  if (gapUsd > 0) {
    const declared =
      declaredValueUsd != null ? ` of ${formatUsd(declaredValueUsd)} declared value` : "";
    return {
      state: "under_covered",
      gapUsd,
      headline: `${formatUsd(gapUsd)} uncovered`,
      detail:
        `Effective coverage ${effectiveCoverage != null ? formatUsd(effectiveCoverage) : "unknown"}` +
        `${declared} — this much of the shipment's value has no coverage behind it.`,
      tone: "danger",
    };
  }

  const surplusUsd = roundToCents(-gapUsd);
  if (surplusUsd === 0) {
    return {
      state: "fully_covered",
      surplusUsd: 0,
      headline: "Fully covered",
      detail:
        "Coverage exactly meets the declared value. There is no surplus " +
        "buffer — any value increase reopens the gap.",
      tone: "ok",
    };
  }

  return {
    state: "fully_covered",
    surplusUsd,
    headline: "Fully covered",
    detail: `Coverage exceeds the declared value by ${formatUsd(surplusUsd)}.`,
    tone: "ok",
  };
}

function roundToCents(usd: number): number {
  return Math.round(usd * 100) / 100;
}

/** Compact single-line rendering for tables (the list page). */
export function coverageGapCell(view: CoverageGapView): string {
  return view.state === "under_covered"
    ? `${formatUsd(view.gapUsd)} uncovered`
    : view.state === "fully_covered"
      ? view.surplusUsd > 0
        ? `Covered · ${formatUsd(view.surplusUsd)} surplus`
        : "Covered · exact"
      : "Unknown";
}

/** Cell semantics from the engine, for badges and the matrix visual. */
export const MATRIX_CELL_META: Record<
  MatrixCell,
  { label: string; description: string; toneClass: string }
> = {
  LL: {
    label: "LL",
    description: "Low likelihood · low consequence — routine",
    toneClass: "cell-ll",
  },
  LH: {
    label: "LH",
    description: "Low likelihood · high consequence — severe but unlikely",
    toneClass: "cell-lh",
  },
  HL: {
    label: "HL",
    description: "High likelihood · low consequence — likely but contained",
    toneClass: "cell-hl",
  },
  HH: {
    label: "HH",
    description: "High likelihood · high consequence — act now",
    toneClass: "cell-hh",
  },
};

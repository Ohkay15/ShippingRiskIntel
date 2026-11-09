import type { MatrixCell, RiskProfile } from "@/scoring/engine";
import { MATRIX_CELL_META } from "@/coverage/display";

/**
 * Score and matrix-cell badges. The score badge's tone derives from the
 * record's matrix cell — the cell is the engine's own risk semantics, so
 * the UI invents no parallel banding (LL calm → HH alarming).
 */

export function ScoreBadge({
  profile,
  provisional = false,
}: {
  profile: RiskProfile;
  provisional?: boolean;
}) {
  const meta = MATRIX_CELL_META[profile.cell];
  return (
    <span
      className={`score-badge ${meta.toneClass} ${provisional ? "provisional" : ""}`}
      title={provisional ? "Provisional score — factors need review" : meta.description}
    >
      {profile.score.toFixed(1)}
      <span className="score-badge-scale">/25</span>
    </span>
  );
}

export function MatrixCellBadge({ cell }: { cell: MatrixCell }) {
  const meta = MATRIX_CELL_META[cell];
  return (
    <span className={`matrix-cell-badge ${meta.toneClass}`} title={meta.description}>
      {meta.label}
    </span>
  );
}

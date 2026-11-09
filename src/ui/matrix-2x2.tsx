import { MATRIX_CELL_META } from "@/coverage/display";
import type { MatrixPlacement } from "@/profile/view-model";

/**
 * The 2×2 ISO 31000 matrix with the record plotted on it. Percentages come
 * from the engine's rolled-up indices (weighted-mean likelihood, top-two
 * consequence mean), so the dot position and the cell badge always agree.
 */
export function Matrix2x2({ placement }: { placement: MatrixPlacement }) {
  const meta = MATRIX_CELL_META[placement.cell];
  // Screen coordinates: likelihood rises upward, consequence rightward.
  const leftPct = placement.consequencePct;
  const bottomPct = placement.likelihoodPct;

  return (
    <div className="matrix-2x2" role="img" aria-label={`Risk matrix position: ${meta.label}`}>
      <div className="matrix-2x2-plot">
        <span className="matrix-2x2-cell cell-ll">LL</span>
        <span className="matrix-2x2-cell cell-hl">HL</span>
        <span className="matrix-2x2-cell cell-lh">LH</span>
        <span className="matrix-2x2-cell cell-hh">HH</span>
        <span
          className={`matrix-dot ${meta.toneClass}`}
          style={{
            left: `calc(${leftPct.toFixed(1)}% * 0.86 + 7%)`,
            bottom: `calc(${bottomPct.toFixed(1)}% * 0.86 + 7%)`,
          }}
        />
      </div>
      <div className="matrix-2x2-axis-label matrix-axis-x">Consequence →</div>
      <div className="matrix-2x2-axis-label matrix-axis-y">Likelihood →</div>
    </div>
  );
}

import type { FlaggedField } from "@/extraction/gate";
import { fieldLabel } from "@/intake/form-fields";

const REASON_LABELS: Record<FlaggedField["reason"], string> = {
  low_confidence: "low confidence",
  missing: "not found in documents",
  invalid_value: "value failed validation",
};

/**
 * Every field the confidence gate stopped, with the provider's verbatim
 * evidence — the operator judges the quote, then corrects the record.
 */
export function ReviewPanel({ flaggedFields }: { flaggedFields: FlaggedField[] }) {
  return (
    <section className="document-panel review-panel">
      <h2>Needs review ({flaggedFields.length})</h2>
      <p className="field-hint">
        These fields did not pass the confidence gate. Correct them via the
        intake form or upload a cleaner document, then confirm the record
        again.
      </p>
      <ul className="flagged-list">
        {flaggedFields.map((flag) => (
          <li key={flag.path} className="flagged-row">
            <div className="flagged-head">
              <span>{fieldLabel(flag.path)}</span>
              <span className="mono">
                {REASON_LABELS[flag.reason]} · confidence {flag.confidence.toFixed(2)}
              </span>
            </div>
            <p className="mono evidence">&ldquo;{flag.evidence}&rdquo;</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

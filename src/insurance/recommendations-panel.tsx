import type { InsuranceProductView, LimitGuidanceView } from "./recommendation-view";

/**
 * The insurance sections of the profile page — the counterpart of the
 * carrier panels in `carriers/recommendations-panel.tsx`: coverage-limit
 * guidance leads, then up to three product cards with concrete dollar gap
 * deltas. Both render pure views from `recommendation-view.ts` — no logic
 * lives here.
 */

function limitStatusLabel(view: LimitGuidanceView): string {
  switch (view.status) {
    case "adequate":
      return "Current coverage meets this limit";
    case "shortfall":
      return `${view.shortfallText ?? "Shortfall"} uncovered against this limit`;
    case "coverage_unknown":
      return "Coverage on file unknown";
    case "no_guidance":
      return "No limit guidance";
  }
}

export function InsuranceRecommendationsPanel({
  limitView,
  views,
  matrixSourceLabel,
}: {
  limitView: LimitGuidanceView;
  views: InsuranceProductView[];
  matrixSourceLabel: string;
}) {
  return (
    <section className="document-panel insurance-panel" aria-label="Insurance recommendations">
      <h2>Insurance recommendations</h2>
      <p className="field-hint">
        Coverage-limit guidance first, then the best-fit insurer products for
        this shipment&rsquo;s cargo type, hazard class, mode, and lane risk.
        Each projection is the record re-scored with that product&rsquo;s
        coverage — the same engine that produced this profile. Pick one
        (plus, optionally, a carrier above) and action the record.
      </p>

      <div className="insurance-limit" data-testid="insurance-limit-guidance">
        <div className="insurance-limit-head">
          {limitView.headline && (
            <span className="insurance-limit-amount">{limitView.headline}</span>
          )}
          <span
            className={`insurance-limit-status insurance-limit-${limitView.status}`}
            data-testid="insurance-limit-status"
          >
            {limitStatusLabel(limitView)}
          </span>
        </div>
        <p className="field-hint">{limitView.rationale}</p>
      </div>

      {views.length === 0 ? (
        <p className="field-hint" data-testid="insurance-recs-empty">
          No insurer products in the fit matrix match this shipment&rsquo;s
          cargo type, hazard class, mode, and lane risk. The owner&rsquo;s
          insurer table may need a product for this lane.
        </p>
      ) : (
        <>
          <p className="field-hint mono">{matrixSourceLabel}</p>
          <ul className="carrier-cards">
            {views.map((view) => (
              <li key={view.productId} className="carrier-card" data-testid={`insurance-card-${view.productId}`}>
                <div className="carrier-card-head">
                  <span className="carrier-name">{view.title}</span>
                  <span
                    className={`carrier-delta ${view.improves ? "carrier-delta-improves" : "carrier-delta-worsens"}`}
                    data-testid={`insurance-delta-${view.productId}`}
                  >
                    {view.gapAfterText} ({view.gapDeltaShortText})
                  </span>
                </div>
                {view.notes && <p className="field-hint">{view.notes}</p>}
                <ul className="carrier-delta-list">
                  <li>
                    <span>Coverage gap</span>
                    <span className="mono">
                      {view.gapBeforeText} → {view.gapAfterText}
                    </span>
                  </li>
                  <li>
                    <span>Exposure</span>
                    <span className="mono">{view.gapDeltaText}</span>
                  </li>
                  <li>
                    <span>Coverage provided</span>
                    <span className="mono">{view.providedCoverageText}</span>
                  </li>
                  {view.effectiveCoverageText && (
                    <li>
                      <span>Effective coverage</span>
                      <span>{view.effectiveCoverageText}</span>
                    </li>
                  )}
                  <li>
                    <span>Limit fit</span>
                    <span>{view.limitFitText}</span>
                  </li>
                  <li>
                    <span>Terms</span>
                    <span>{view.liabilityTerms}</span>
                  </li>
                  <li>
                    <span>Projected score</span>
                    <span className="mono">{view.projectedScore.toFixed(1)} /25</span>
                  </li>
                </ul>
                <div className="carrier-card-actions">
                  <label className="pick-toggle">
                    <input type="checkbox" name="picks" value={`insurance:${view.productId}`} />
                    <span>Pick {view.title}</span>
                  </label>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

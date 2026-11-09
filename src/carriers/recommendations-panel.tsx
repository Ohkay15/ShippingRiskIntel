import { pickCarrierRecommendation } from "@/app/actions/carriers";
import { PickCarrierButton } from "@/ui/pick-carrier-button";

import type { ActionedView, RecommendationView } from "./recommendation-view";

/**
 * The carrier sections of the profile page (spec §3's last block). Both
 * panels render the pure views from `recommendation-view.ts` — no logic
 * lives here.
 */

export function CarrierRecommendationsPanel({
  shipmentId,
  views,
  matrixSourceLabel,
}: {
  shipmentId: string;
  views: RecommendationView[];
  matrixSourceLabel: string;
}) {
  return (
    <section className="document-panel carrier-panel" aria-label="Carrier recommendations">
      <h2>Carrier recommendations</h2>
      <p className="field-hint">
        Three best-fit carriers for this shipment&rsquo;s cargo type, mode, and
        lane risk. Each projection is the record re-scored with that
        carrier&rsquo;s record and liability limit — the same engine that
        produced this profile. Picking one actions the record.
      </p>
      {views.length === 0 ? (
        <p className="field-hint" data-testid="carrier-recs-empty">
          No carriers in the fit matrix match this shipment&rsquo;s cargo type,
          mode, and lane risk. The owner&rsquo;s carrier table may need a
          carrier for this lane.
        </p>
      ) : (
        <>
          <p className="field-hint mono">{matrixSourceLabel}</p>
          <ul className="carrier-cards">
            {views.map((view) => (
              <li key={view.carrierId} className="carrier-card" data-testid={`carrier-card-${view.carrierId}`}>
                <div className="carrier-card-head">
                  <span className="carrier-name">{view.carrierName}</span>
                  <span
                    className={`carrier-delta ${view.improves ? "carrier-delta-improves" : "carrier-delta-worsens"}`}
                    data-testid={`carrier-delta-${view.carrierId}`}
                  >
                    {view.projectedScore} ({view.scoreDeltaText})
                  </span>
                </div>
                {view.factors.length > 0 ? (
                  <ul className="carrier-delta-list">
                    {view.factors.map((factor) => (
                      <li
                        key={factor.key}
                        className={factor.improves ? "delta-improves" : "delta-worsens"}
                      >
                        <span>{factor.label}</span>
                        <span className="mono">
                          {factor.beforeText} → {factor.afterText} · {factor.deltaText}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="field-hint">
                    No factor rating changes under this carrier.
                  </p>
                )}
                <div className="carrier-card-actions">
                  <PickCarrierButton
                    action={pickCarrierRecommendation.bind(null, shipmentId, view.carrierId)}
                    carrierName={view.carrierName}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function ActionedPanel({ view }: { view: ActionedView }) {
  return (
    <section className="document-panel carrier-panel" aria-label="Actioned carrier">
      <h2>Actioned — carrier selected</h2>
      <p>
        This record is locked with <strong>{view.carrierName}</strong> as the
        chosen carrier.
      </p>
      {view.projectedScore == null || view.projectedCell == null ? (
        <p className="field-hint">
          No post-action projection is stored for this record — it was actioned
          before projections were kept.
        </p>
      ) : (
        <>
          <p className="metric-sub" data-testid="actioned-projection">
            Post-action projected position: score {view.projectedScore}, matrix
            cell {view.projectedCell} (from {view.currentScore}).
          </p>
          {view.factors.length > 0 && (
            <ul className="carrier-delta-list">
              {view.factors.map((factor) => (
                <li key={factor.key} className={factor.improves ? "delta-improves" : "delta-worsens"}>
                  <span>{factor.label}</span>
                  <span className="mono">
                    {factor.beforeText} → {factor.afterText} · {factor.deltaText}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

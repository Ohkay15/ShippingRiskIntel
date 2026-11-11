import Link from "next/link";
import { displayShipmentId } from "@/dashboard/record-id";
import { desc, eq } from "drizzle-orm";

import { uploadDocument } from "@/app/actions/documents";
import { confirmAndScore } from "@/app/actions/update";
import { db } from "@/db";
import { shipments, shipmentDocuments } from "@/db/schema";
import type { ShipmentStatus } from "@/db/lifecycle";
import {
  DOCUMENT_KIND_LABELS,
  type DocumentKind,
} from "@/documents/kinds";
import { DocumentUploadPanel } from "@/documents/document-upload-panel";
import { ConfirmExtractPanel } from "@/extraction/confirm-extract-panel";
import { ReviewPanel } from "@/extraction/review-panel";
import type { FlaggedField } from "@/extraction/gate";
import { coverageGapView } from "@/coverage/display";
import { effectiveCoverageUsd } from "@/schemas/shipment";
import { factorRows, matrixPlacement, recordSummary } from "@/profile/view-model";
import type { RiskProfile } from "@/scoring/engine";
import { ConfirmAndScoreButton } from "@/ui/confirm-and-score-button";
import { CoverageGapHero } from "@/ui/gap-hero";
import { Matrix2x2 } from "@/ui/matrix-2x2";
import { MatrixCellBadge, ScoreBadge } from "@/ui/risk-badges";
import { StatusBadge } from "@/ui/status-badge";
import { FactorBasisBadge } from "@/ui/factor-basis-badge";
import { shipmentIntakeSchema, type ShipmentIntake } from "@/schemas/shipment";
import { PLACEHOLDER_CARRIER_FIT_MATRIX } from "@/carriers/matrix-data";
import { recommendCarriers } from "@/carriers/recommend";
import { actionedView, recommendationViews } from "@/carriers/recommendation-view";
import { ActionedPanel, CarrierRecommendationsPanel } from "@/carriers/recommendations-panel";
import { actionWithPicks } from "@/app/actions/picks";
import { ActionPicksForm } from "@/profile/action-picks-form";
import { PLACEHOLDER_INSURER_FIT_MATRIX } from "@/insurance/matrix-data";
import { recommendCoverageLimit } from "@/insurance/limit";
import { appliedCoverageUsd, recommendInsurance } from "@/insurance/recommend";
import {
  insuranceRecommendationViews,
  limitGuidanceView,
} from "@/insurance/recommendation-view";
import { InsuranceRecommendationsPanel } from "@/insurance/recommendations-panel";
import { IntakeSummary } from "./intake-summary";

export const dynamic = "force-dynamic";

interface ShipmentRow {
  id: string;
  status: ShipmentStatus;
  intakeData: ShipmentIntake;
  profile: RiskProfile | null;
  scoredAt: Date | null;
  flaggedFields: FlaggedField[] | null;
  confirmedFactors: string[];
  actionedCarrierId: string | null;
  actionedInsuranceProductId: string | null;
  projectedProfile: RiskProfile | null;
}

export default async function ShipmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let record: ShipmentRow | undefined;
  let documents: {
    id: string;
    kind: DocumentKind;
    filename: string;
    createdAt: Date;
  }[] = [];
  let hasDocuments = false;

  try {
    const rows = await db
      .select({
        id: shipments.id,
        status: shipments.status,
        intakeData: shipments.intakeData,
        profile: shipments.profile,
        scoredAt: shipments.scoredAt,
        flaggedFields: shipments.flaggedFields,
        confirmedFactors: shipments.confirmedFactors,
        actionedCarrierId: shipments.actionedCarrierId,
        actionedInsuranceProductId: shipments.actionedInsuranceProductId,
        projectedProfile: shipments.projectedProfile,
      })
      .from(shipments)
      .where(eq(shipments.id, id))
      .limit(1);
    const row = rows[0];
    // Re-validate at the boundary: stored JSON is trusted only after it
    // parses against the shared contract.
    const intake = row
      ? shipmentIntakeSchema.safeParse(row.intakeData)
      : undefined;
    if (row && intake?.success) {
      record = {
        id: row.id,
        status: row.status,
        intakeData: intake.data,
        profile: row.profile ?? null,
        scoredAt: row.scoredAt ?? null,
        flaggedFields: row.flaggedFields ?? null,
        confirmedFactors: row.confirmedFactors,
        actionedCarrierId: row.actionedCarrierId ?? null,
        actionedInsuranceProductId: row.actionedInsuranceProductId ?? null,
        projectedProfile: row.projectedProfile ?? null,
      };
      documents = await db
        .select({
          id: shipmentDocuments.id,
          kind: shipmentDocuments.kind,
          filename: shipmentDocuments.filename,
          createdAt: shipmentDocuments.createdAt,
        })
        .from(shipmentDocuments)
        .where(eq(shipmentDocuments.shipmentId, id))
        .orderBy(desc(shipmentDocuments.createdAt));
      hasDocuments = documents.length > 0;
    } else {
      record = undefined;
    }
  } catch {
    return <DatabaseUnavailable />;
  }

  if (!record) {
    return <RecordNotFound id={id} />;
  }

  const showProfile =
    record.profile != null &&
    (record.status === "scored" || record.status === "needs_review");
  const provisional = record.status === "needs_review";

  let actionedViewData = null;
  if (record.status === "actioned" && record.profile) {
    const carrier = record.actionedCarrierId
      ? PLACEHOLDER_CARRIER_FIT_MATRIX.carriers.find(
          (entry) => entry.id === record.actionedCarrierId
        ) ?? null
      : null;
    const product = record.actionedInsuranceProductId
      ? PLACEHOLDER_INSURER_FIT_MATRIX.products.find(
          (entry) => entry.id === record.actionedInsuranceProductId
        ) ?? null
      : null;
    actionedViewData = actionedView(
      record.actionedCarrierId,
      carrier?.name ?? null,
      record.profile,
      record.projectedProfile,
      record.actionedInsuranceProductId
        ? {
            label: product
              ? `${product.insurerName} — ${product.productName}`
              : record.actionedInsuranceProductId,
            found: product != null,
            appliedLimitUsd:
              product && record.profile
                ? appliedCoverageUsd(
                    product,
                    recommendCoverageLimit(record.intakeData, record.profile)
                      .recommendedLimitUsd
                  )
                : null,
          }
        : null
    );
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Shipment {displayShipmentId(record.id)}</h1>
          <p className="mono">{record.id}</p>
        </div>
        <div className="page-header-actions">
          <StatusBadge status={record.status} />
          {record.profile && (
            <Link
              href={`/assistant?q=${encodeURIComponent(`Explain ${displayShipmentId(record.id).startsWith("SH-") ? displayShipmentId(record.id) : record.id}`)}`}
              className="button-secondary"
            >
              Ask about this
            </Link>
          )}
          {record.status !== "actioned" && record.status !== "extracting" && (
            <Link href={`/shipments/${record.id}/edit`} className="button-secondary">
              Edit &amp; re-score
            </Link>
          )}
        </div>
      </header>

      {record.status === "draft" && !hasDocuments && (
        <section className="document-panel">
          <h2>Confirm this record</h2>
          <p className="field-hint">
            No documents are attached, so the entered fields are the record.
            Confirming scores it immediately — unknown fields take their
            conservative default and park the record in review instead of
            guessing.
          </p>
          <ConfirmAndScoreButton action={confirmAndScore.bind(null, record.id)} label="Confirm & score" />
        </section>
      )}

      {record.status === "draft" && hasDocuments && (
        <ConfirmExtractPanel shipmentId={record.id} />
      )}

      {record.status === "extracting" && (
        <section className="document-panel">
          <h2>Extracting…</h2>
          <p className="field-hint">
            Extraction is running on the attached documents. This page shows
            the result when it completes; the last valid field values stay
            visible below.
          </p>
        </section>
      )}

      {record.status === "needs_review" && record.flaggedFields && (
        <>
          <ReviewPanel flaggedFields={record.flaggedFields} />
          <p className="page-links">
            <Link href="/review">Resolve in the review queue</Link> — edit the
            flagged fields there; the record re-scores the moment you save.
          </p>
        </>
      )}

      {actionedViewData && <ActionedPanel view={actionedViewData} />}

      {showProfile && record.profile && (
        <ProfileOutput
          shipmentId={record.id}
          intake={record.intakeData}
          profile={record.profile}
          scoredAt={record.scoredAt}
          provisional={provisional}
        />
      )}

      <DocumentUploadPanel
        shipmentId={record.id}
        action={uploadDocument.bind(null, record.id)}
      />

      {hasDocuments ? (
        <section className="document-panel">
          <h2>Attached documents</h2>
          <ul className="document-list">
            {documents.map((doc) => (
              <li key={doc.id} className="document-row">
                <span>{DOCUMENT_KIND_LABELS[doc.kind]}</span>
                <span className="mono">{doc.filename}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="document-panel">
          <h2>Attached documents</h2>
          <p className="field-hint">
            No documents attached yet. Upload a commercial invoice, packing
            list, bill of lading, or DG declaration above to pre-fill this
            record from its contents.
          </p>
        </section>
      )}

      <IntakeSummary intake={record.intakeData} />

      <p className="page-footer">
        <Link href="/">← All shipments</Link>
      </p>
    </main>
  );
}

/**
 * The scored profile output (spec §3): the coverage gap leads, then the
 * score and matrix position, then the factor breakdown where every rating
 * shows its basis, then carrier recommendations.
 */
function ProfileOutput({
  shipmentId,
  intake,
  profile,
  scoredAt,
  provisional,
}: {
  shipmentId: string;
  intake: ShipmentIntake;
  profile: RiskProfile;
  scoredAt: Date | null;
  provisional: boolean;
}) {
  const rows = factorRows(profile);
  const placement = matrixPlacement(profile);
  const gapView = coverageGapView(
    profile.coverageGapUsd,
    intake.value_fragility.declaredValueUsd ?? null,
    effectiveCoverageUsd(intake.coverage)
  );
  // Static fit matrices (spec Phase 4): recommendations are pure engine
  // output over the confirmed record; picking one is the gate below.
  const recommendationViewsData = provisional
    ? []
    : recommendationViews(
        recommendCarriers(intake, profile, PLACEHOLDER_CARRIER_FIT_MATRIX)
      );
  // Insurance mirrors the carrier path: limit guidance from the record,
  // then product projections through the real engine — concrete dollar
  // gap deltas, never generic rationale strings.
  const limitRecommendation = recommendCoverageLimit(intake, profile);
  const insuranceViewsData = provisional
    ? []
    : insuranceRecommendationViews(
        recommendInsurance(
          intake,
          profile,
          PLACEHOLDER_INSURER_FIT_MATRIX,
          limitRecommendation.recommendedLimitUsd
        ),
        profile.coverageGapUsd
      );

  return (
    <section className="profile-output" aria-label="Risk profile">
      {provisional && (
        <div className="form-banner form-banner-warning" role="status">
          Provisional profile — scored with conservative defaults for the
          flagged factors. Resolve them to firm this up.
        </div>
      )}

      <CoverageGapHero
        gapUsd={profile.coverageGapUsd}
        declaredValueUsd={intake.value_fragility.declaredValueUsd ?? null}
        effectiveCoverageUsd={effectiveCoverageUsd(intake.coverage)}
      />

      <div className="profile-metrics">
        <div className="profile-score-block">
          <p className="metric-label">Composite score</p>
          <ScoreBadge profile={profile} provisional={provisional} />
          <p className="metric-sub">
            {gapView.state === "under_covered"
              ? `Exposure: ${gapView.headline}`
              : gapView.headline}
          </p>
          <p className="metric-sub">
            Scored {scoredAt ? scoredAt.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—"}
          </p>
        </div>
        <Matrix2x2 placement={placement} />
        <div className="profile-cell-block">
          <p className="metric-label">Matrix position</p>
          <MatrixCellBadge cell={profile.cell} />
          <p className="metric-sub">{recordSummary(intake)}</p>
        </div>
      </div>

      <div className="profile-factors">
        <h2>Factor breakdown</h2>
        <p className="field-hint">
          Every rating shows where it came from — a scoring rule, the
          extraction model&rsquo;s judgment with its confidence, a human
          confirmation, or a conservative default. Highest-contribution
          factors lead.
        </p>
        <table className="factor-table">
          <thead>
            <tr>
              <th>Factor</th>
              <th>L × C</th>
              <th>Weight</th>
              <th>Contribution</th>
              <th>Basis</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} data-testid={`factor-row-${row.key}`}>
                <td>{row.label}</td>
                <td className="nowrap">
                  {row.likelihood} × {row.consequence}
                </td>
                <td>{(row.weight * 100).toFixed(0)}%</td>
                <td className="mono">{row.contribution.toFixed(2)}</td>
                <td className="factor-basis-cell">
                  <FactorBasisBadge basis={row.basis} />
                  <span className="basis-detail">{row.basis.detail}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {provisional ? (
        <>
          <section className="document-panel carrier-panel" aria-label="Carrier recommendations">
            <h2>Carrier recommendations</h2>
            <p className="field-hint">
              Recommendations appear once the flagged factors are resolved —
              they are projected from the confirmed record only.
            </p>
          </section>
          <section className="document-panel insurance-panel" aria-label="Insurance recommendations">
            <h2>Insurance recommendations</h2>
            <p className="field-hint">
              Insurance guidance appears once the flagged factors are resolved —
              it is projected from the confirmed record only.
            </p>
          </section>
        </>
      ) : (
        <ActionPicksForm action={actionWithPicks.bind(null, shipmentId)}>
          <CarrierRecommendationsPanel
            views={recommendationViewsData}
            matrixSourceLabel={PLACEHOLDER_CARRIER_FIT_MATRIX.sourceLabel}
          />
          <InsuranceRecommendationsPanel
            limitView={limitGuidanceView(limitRecommendation)}
            views={insuranceViewsData}
            matrixSourceLabel={PLACEHOLDER_INSURER_FIT_MATRIX.sourceLabel}
          />
        </ActionPicksForm>
      )}
    </section>
  );
}

function DatabaseUnavailable() {
  return (
    <main className="page">
      <div className="state-panel state-error">
        <h1>Database unavailable</h1>
        <p>
          The record could not be loaded because the database is not
          reachable. Start Postgres with <code>docker compose up -d</code> and
          retry.
        </p>
        <Link href="/" className="button-secondary">
          ← All shipments
        </Link>
      </div>
    </main>
  );
}

function RecordNotFound({ id }: { id: string }) {
  return (
    <main className="page">
      <div className="state-panel">
        <h1>Record not found</h1>
        <p>No readable shipment record exists with id {id}.</p>
        <Link href="/" className="button-secondary">
          ← All shipments
        </Link>
      </div>
    </main>
  );
}

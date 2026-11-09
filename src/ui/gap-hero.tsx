import { coverageGapView, formatUsd } from "@/coverage/display";

/**
 * The profile's lead element: the dollar gap between declared value and
 * coverage. Per spec, the gap number leads; a covered shipment shows that
 * clearly (surplus stated, or exact-match warning) and missing coverage
 * data reads "unknown" — never a misleading $0.
 */
export function CoverageGapHero({
  gapUsd,
  declaredValueUsd,
  effectiveCoverageUsd,
}: {
  gapUsd: number | null;
  declaredValueUsd: number | null;
  effectiveCoverageUsd: number | null;
}) {
  const view = coverageGapView(gapUsd, declaredValueUsd, effectiveCoverageUsd);

  return (
    <section className={`gap-hero gap-${view.tone}`} aria-live="polite">
      <p className="gap-hero-eyebrow">Coverage gap</p>
      <p className="gap-hero-headline">{view.headline}</p>
      <p className="gap-hero-detail">{view.detail}</p>
      {view.state === "fully_covered" && view.surplusUsd > 0 && (
        <p className="gap-hero-buffer">
          Buffer above declared value: {formatUsd(view.surplusUsd)}
        </p>
      )}
    </section>
  );
}

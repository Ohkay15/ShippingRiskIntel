import type { FactorBasisView } from "@/profile/view-model";

/**
 * The chip that says where a factor rating came from — the product's
 * explainability stance rendered: the system presents its case.
 */

const KIND_CLASS: Record<FactorBasisView["kind"], string> = {
  rule: "basis-rule",
  llm: "basis-llm",
  review: "basis-review",
  default: "basis-default",
};

export function FactorBasisBadge({ basis }: { basis: FactorBasisView }) {
  const confidence =
    basis.confidence != null
      ? ` · ${(basis.confidence * 100).toFixed(0)}% confidence`
      : "";
  return (
    <span className={`basis-badge ${KIND_CLASS[basis.kind]}`}>
      {basis.label}
      {confidence}
    </span>
  );
}

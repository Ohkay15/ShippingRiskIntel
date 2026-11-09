"use client";

import { useActionState } from "react";

import { FieldInput } from "@/intake/intake-form";
import type { IntakeFormState } from "@/intake/form-state";
import { IDLE_FORM_STATE } from "@/intake/form-state";
import { FACTOR_GROUP_META, type FormFieldDef } from "@/intake/form-fields";
import type { FlaggedField } from "@/extraction/gate";
import type { FactorKey } from "@/schemas/shipment";

type ResolveAction = (
  state: IntakeFormState,
  formData: FormData
) => Promise<IntakeFormState>;

interface ReviewResolveFormProps {
  action: ResolveAction;
  flaggedFields: FlaggedField[];
  /** Current values keyed by wire path (serialized from the stored intake). */
  defaults: Record<string, string | string[]>;
  /** Factors the flags touch, key + title, for the accept-at-default row. */
  affectedFactors: { key: FactorKey; title: string }[];
  submitLabel?: string;
}

const FIELD_BY_PATH = new Map<string, FormFieldDef>(
  FACTOR_GROUP_META.flatMap((group) =>
    group.fields.map((field) => [field.path, field])
  )
);

const REASON_LABEL: Record<FlaggedField["reason"], string> = {
  low_confidence: "extraction confidence below 0.75",
  missing: "required value missing from the documents",
  invalid_value: "extracted value failed validation",
};

/**
 * One record's resolution form: every flagged field becomes an editable
 * input pre-filled with the stored value, with the reason and the
 * provider's verbatim evidence beside it. Confirming at default is a
 * per-factor checkbox — the conservative rating then carries a human
 * review basis instead of a silent default flag.
 */
export function ReviewResolveForm({
  action,
  flaggedFields,
  defaults,
  affectedFactors,
  submitLabel = "Resolve and re-score",
}: ReviewResolveFormProps) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="review-resolve-form">
      {state.status === "error" && state.message && (
        <div role="alert" className="form-banner form-banner-error">
          {state.message}
        </div>
      )}

      <ul className="flagged-fields">
        {flaggedFields.map((flag) => {
          const field = FIELD_BY_PATH.get(flag.path);
          if (!field) return null;
          return (
            <li key={flag.path} className="flagged-field">
              <p className="flag-evidence">
                <strong>{REASON_LABEL[flag.reason]}</strong> at{" "}
                {(flag.confidence * 100).toFixed(0)}% confidence — evidence:{" "}
                <em>&ldquo;{flag.evidence}&rdquo;</em>
              </p>
              <FieldInput
                field={field}
                error={state.fieldErrors[flag.path]}
                defaultValue={defaults[flag.path] ?? ""}
              />
            </li>
          );
        })}
      </ul>

      {affectedFactors.length > 0 && (
        <fieldset className="factor-group accept-defaults">
          <legend>Leave unknown, accept the conservative default</legend>
          <p className="field-hint">
            The factor still scores at its default rating, with your
            confirmation recorded as the basis — the record can then leave
            review without a guessed value.
          </p>
          {affectedFactors.map((factor) => (
            <label key={factor.key} className="confirm-default-option">
              <input
                type="checkbox"
                name={`confirm_factor_${factor.key}`}
                value="on"
              />
              {factor.title}
            </label>
          ))}
        </fieldset>
      )}

      <button type="submit" disabled={pending} className="button-primary">
        {pending ? "Re-scoring…" : submitLabel}
      </button>
    </form>
  );
}

"use client";

import { optionLabel } from "./option-labels";
import { useActionState } from "react";

import { FACTOR_GROUP_META, type FormFieldDef } from "@/intake/form-fields";
import { IDLE_FORM_STATE, type IntakeFormState } from "@/intake/form-state";
import type { FactorKey, ShipmentIntake } from "@/schemas/shipment";

type SubmitAction = (
  state: IntakeFormState,
  formData: FormData
) => Promise<IntakeFormState>;

interface IntakeFormProps {
  action: SubmitAction;
  /** Pre-filled values (e.g. extracted from a document) keyed by wire path. */
  defaults?: ShipmentIntake | null;
  submitLabel: string;
}

export function IntakeForm({ action, defaults, submitLabel }: IntakeFormProps) {
  const [state, formAction, isPending] = useActionState(action, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="intake-form">
      {state.status === "error" && state.message && (
        <div role="alert" className="form-banner form-banner-error">
          {state.message}
        </div>
      )}

      {FACTOR_GROUP_META.map((group) => (
        <fieldset key={group.key} className="factor-group">
          <legend>
            {group.title}
            <span className="factor-source">{group.source}</span>
          </legend>
          {group.fields.map((field) => (
            <FieldInput
              key={field.path}
              field={field}
              error={state.fieldErrors[field.path]}
              defaultValue={defaultFor(defaults, group.key, field.path)}
            />
          ))}
        </fieldset>
      ))}

      <button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

function defaultFor(
  defaults: ShipmentIntake | null | undefined,
  group: FactorKey,
  path: string
): string | string[] {
  const leaf = path.split(".")[1];
  const groupDefault = defaults?.[group] as unknown as
    | Record<string, unknown>
    | undefined;
  const value = leaf && groupDefault ? groupDefault[leaf] : undefined;

  if (value == null) return "";
  if (Array.isArray(value)) return value.map(String);
  return String(value);
}

/**
 * One intake field, rendered from its declarative def. Shared by the full
 * intake form and the review queue's flagged-field editors so a field can
 * never render differently in the two surfaces.
 */
export function FieldInput({
  field,
  error,
  defaultValue,
}: {
  field: FormFieldDef;
  error: string | undefined;
  defaultValue: string | string[];
}) {
  const id = field.path.replace(/\./g, "-");
  const invalid = error ? { "aria-invalid": true } : {};

  return (
    <div className={`field field-${field.kind} ${error ? "field-error" : ""}`}>
      <label htmlFor={id}>{field.label}</label>

      {field.kind === "text" && (
        <input
          id={id}
          name={field.path}
          type="text"
          defaultValue={defaultValue}
          {...invalid}
        />
      )}

      {field.kind === "number" && (
        <input
          id={id}
          name={field.path}
          type="number"
          min={field.min}
          max={field.max}
          step={field.step}
          defaultValue={defaultValue}
          {...invalid}
        />
      )}

      {field.kind === "boolean" && (
        <select id={id} name={field.path} defaultValue={defaultValue} {...invalid}>
          <option value="">Unknown</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      )}

      {field.kind === "enum" && (
        <select id={id} name={field.path} defaultValue={defaultValue} {...invalid}>
          <option value="">Unknown</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {optionLabel(option)}
            </option>
          ))}
        </select>
      )}

      {field.kind === "multi" && (
        <div className="multi-options" role="group" aria-label={field.label}>
          {field.options.map((option) => (
            <label key={option} className="multi-option">
              <input
                type="checkbox"
                name={field.path}
                value={option}
                defaultChecked={(defaultValue as string[]).includes(option)}
              />
              {optionLabel(option)}
            </label>
          ))}
        </div>
      )}

      {field.hint && <p className="field-hint">{field.hint}</p>}
      {error && (
        <p className="field-error-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

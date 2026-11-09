"use client";

import { useActionState } from "react";

import type { IntakeFormState } from "@/intake/form-state";

type ConfirmAndScoreAction = (
  state: IntakeFormState,
  formData: FormData
) => Promise<IntakeFormState>;

/**
 * The confirm gate for document-less drafts: one click moves Draft →
 * Scored/Needs review through the scoring gateway. Server action state is
 * rendered as a form banner when the action refuses.
 */
export function ConfirmAndScoreButton({
  action,
  label,
}: {
  action: ConfirmAndScoreAction;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(action, {
    status: "idle" as const,
    message: null,
    fieldErrors: {},
  });

  return (
    <form action={formAction}>
      <button type="submit" disabled={pending} className="button-primary">
        {pending ? "Scoring…" : label}
      </button>
      {state.status === "error" && state.message && (
        <p role="alert" className="field-error-message">
          {state.message}
        </p>
      )}
    </form>
  );
}

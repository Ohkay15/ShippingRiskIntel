"use client";

import { useActionState } from "react";

import type { PickCarrierState } from "@/app/actions/carriers";

type PickCarrierAction = (
  state: PickCarrierState,
  formData: FormData
) => Promise<PickCarrierState>;

/**
 * The pick gate on a recommendation card: one click moves Scored →
 * Actioned with the carrier's projected position. Server action state is
 * rendered as an inline alert when the transition refuses.
 */
export function PickCarrierButton({
  action,
  carrierName,
}: {
  action: PickCarrierAction;
  carrierName: string;
}) {
  const [state, formAction, pending] = useActionState(action, {
    status: "idle" as const,
    message: null,
  });

  return (
    <form action={formAction}>
      <button type="submit" disabled={pending} className="button-secondary">
        {pending ? "Actioning…" : `Select ${carrierName}`}
      </button>
      {state.status === "error" && state.message && (
        <p role="alert" className="field-error-message">
          {state.message}
        </p>
      )}
    </form>
  );
}

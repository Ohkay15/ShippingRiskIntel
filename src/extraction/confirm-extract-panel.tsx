"use client";

import { useActionState } from "react";

import { confirmShipment, type ConfirmState } from "@/app/actions/extraction";

const INITIAL_STATE: ConfirmState = { status: "idle" };

/**
 * The human confirmation gate: extraction runs only when the operator
 * presses this button. Uploads never auto-extract or auto-score.
 */
export function ConfirmExtractPanel({ shipmentId }: { shipmentId: string }) {
  const [state, formAction, pending] = useActionState(
    confirmShipment,
    INITIAL_STATE
  );

  return (
    <section className="document-panel">
      <h2>Confirm record</h2>
      <p className="field-hint">
        Confirming runs extraction on every attached document. Fields the
        provider reads below the 0.75 confidence threshold are nulled and
        routed to review — extraction never fills a field it cannot defend.
      </p>
      <form action={formAction} className="upload-row">
        <input type="hidden" name="shipmentId" value={shipmentId} />
        <button type="submit" disabled={pending} className="button-primary">
          {pending ? "Extracting…" : "Confirm & extract"}
        </button>
      </form>
      {state.status === "error" && (
        <p role="alert" className="state-error">
          {state.message}
        </p>
      )}
      {state.status === "done" && (
        <p role="status">{state.message}</p>
      )}
    </section>
  );
}

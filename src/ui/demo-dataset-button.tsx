"use client";

import { useActionState } from "react";

import { seedDemoDataset, type DemoSeedState } from "@/app/actions/demo";

const INITIAL_STATE: DemoSeedState = { status: "idle" };

/**
 * Loads the 40-record synthetic dataset as real scored rows. Offered only
 * while the list is empty — real records always win over demo data.
 */
export function DemoDatasetButton() {
  const [state, formAction, pending] = useActionState(
    seedDemoDataset,
    INITIAL_STATE
  );

  return (
    <form action={formAction} className="upload-row demo-seed-form">
      <button type="submit" disabled={pending} className="button-primary">
        {pending ? "Loading demo dataset…" : "Load the 40-record demo dataset"}
      </button>
      <p className="field-hint">
        Synthetic intra-US records spanning the full risk matrix — scores,
        matrix positions, and coverage gaps included. Two records land in the
        review queue with coverage data missing.
      </p>
      {state.status === "error" && (
        <p role="alert" className="field-error-message">
          {state.message}
        </p>
      )}
    </form>
  );
}

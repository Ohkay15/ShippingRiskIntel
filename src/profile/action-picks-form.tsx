"use client";

import { useActionState, useState } from "react";

import type { ActionPicksState } from "@/app/actions/picks";

type ActionPicksAction = (
  state: ActionPicksState,
  formData: FormData
) => Promise<ActionPicksState>;

/**
 * The pick gate spanning both recommendation panels: the carrier and
 * insurance cards render as children (server components — the scoring
 * engine never ships to the client), each with a pick checkbox, and ONE
 * action bar submits the transition. The count and the disabled state
 * read the form's own checkboxes on change, so they stay honest without
 * duplicating card state in React.
 */
export function ActionPicksForm({
  action,
  children,
}: {
  action: ActionPicksAction;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {
    status: "idle" as const,
    message: null,
  });
  const [pickCount, setPickCount] = useState(0);

  return (
    <form
      action={formAction}
      onChange={(event) => {
        const formData = new FormData(event.currentTarget);
        setPickCount(formData.getAll("picks").length);
      }}
    >
      {children}
      <div className="action-bar">
        <button type="submit" className="button-primary" disabled={pending || pickCount === 0}>
          {pending
            ? "Actioning…"
            : pickCount === 0
              ? "Select a carrier or insurance product"
              : `Action record with ${pickCount} pick${pickCount === 1 ? "" : "s"}`}
        </button>
        <p className="action-bar-hint">
          One carrier, one insurance product, or both — the record actions
          once, with the projected post-action position from both picks.
        </p>
        {state.status === "error" && state.message && (
          <p role="alert" className="field-error-message">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

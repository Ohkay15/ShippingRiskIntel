/**
 * State shape shared by the intake server actions and the client form.
 * Kept out of the "use server" module so client components can import it
 * without pulling server-only code into the bundle.
 */
export interface IntakeFormState {
  status: "idle" | "error";
  /** One message for the form-level error banner. */
  message: string | null;
  /** Field-level errors keyed by dotted wire path ("cargo_hazard.unNumber"). */
  fieldErrors: Record<string, string>;
}

export const IDLE_FORM_STATE: IntakeFormState = {
  status: "idle",
  message: null,
  fieldErrors: {},
};

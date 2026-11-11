/** Form states shared by the auth server actions and their client forms. */
export interface AuthFormState {
  status: "idle" | "error" | "success";
  message: string | null;
  fieldErrors: Record<string, string>;
  /** Non-secret values to put back in the form after an error (never passwords). */
  values?: Record<string, string>;
}

export const IDLE_AUTH_STATE: AuthFormState = { status: "idle", message: null, fieldErrors: {} };

export interface ApiKeyFormState {
  status: "idle" | "error" | "success";
  message: string | null;
  /** The new key — returned exactly once, never stored in plain text. */
  key: string | null;
}

export const IDLE_API_KEY_STATE: ApiKeyFormState = { status: "idle", message: null, key: null };

"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { changePassword, createApiKey, signIn, signUp, updateProfile } from "@/app/actions/auth";
import { IDLE_API_KEY_STATE, IDLE_AUTH_STATE, type AuthFormState } from "@/auth/form-state";

function Submit({ children, pendingLabel }: { children: React.ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="auth-submit" disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}

function Field({
  name,
  label,
  type = "text",
  autoComplete,
  state,
  defaultValue,
  hint,
  required = true,
}: {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  state: AuthFormState;
  defaultValue?: string;
  hint?: string;
  required?: boolean;
}) {
  const error = state.fieldErrors[name];
  return (
    <label className="auth-field">
      <span>{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        defaultValue={type === "password" ? undefined : (state.values?.[name] ?? defaultValue)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
      />
      {error ? (
        <small id={`${name}-error`} className="auth-error">
          {error}
        </small>
      ) : (
        hint && <small className="auth-hint">{hint}</small>
      )}
    </label>
  );
}

function Banner({ state }: { state: AuthFormState }) {
  if (!state.message) return null;
  return (
    <p className={state.status === "success" ? "auth-banner auth-banner-ok" : "auth-banner"} role="status">
      {state.message}
    </p>
  );
}

export function SignInForm({ next }: { next: string }) {
  const [state, action] = useActionState(signIn, IDLE_AUTH_STATE);
  return (
    <form action={action} className="auth-form">
      <Banner state={state} />
      <input type="hidden" name="next" value={next} />
      <Field name="email" label="Email" type="email" autoComplete="email" state={state} />
      <Field name="password" label="Password" type="password" autoComplete="current-password" state={state} />
      <Submit pendingLabel="Signing in…">Sign in</Submit>
      <p className="auth-switch">
        New here? <Link href="/sign-up">Create an account</Link>
      </p>
    </form>
  );
}

export function SignUpForm({ needsInviteCode, firstAccount }: { needsInviteCode: boolean; firstAccount: boolean }) {
  const [state, action] = useActionState(signUp, IDLE_AUTH_STATE);
  return (
    <form action={action} className="auth-form">
      <Banner state={state} />
      <Field name="name" label="Full name" autoComplete="name" state={state} />
      <Field name="email" label="Work email" type="email" autoComplete="email" state={state} />
      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        state={state}
        hint="At least 10 characters."
      />
      {needsInviteCode && (
        <Field name="inviteCode" label="Invite code" autoComplete="off" state={state} hint="From your workspace owner." />
      )}
      <Submit pendingLabel="Creating account…">{firstAccount ? "Create workspace" : "Create account"}</Submit>
      <p className="auth-switch">
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </form>
  );
}

export function ProfileForm({ name }: { name: string }) {
  const [state, action] = useActionState(updateProfile, IDLE_AUTH_STATE);
  return (
    <form action={action} className="auth-form settings-form">
      <Banner state={state} />
      <Field name="name" label="Name" autoComplete="name" state={state} defaultValue={name} />
      <Submit pendingLabel="Saving…">Save</Submit>
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState(changePassword, IDLE_AUTH_STATE);
  return (
    <form action={action} className="auth-form settings-form" key={state.status === "success" ? "done" : "edit"}>
      <Banner state={state} />
      <Field name="currentPassword" label="Current password" type="password" autoComplete="current-password" state={state} />
      <Field
        name="newPassword"
        label="New password"
        type="password"
        autoComplete="new-password"
        state={state}
        hint="At least 10 characters. Signs out your other devices."
      />
      <Submit pendingLabel="Updating…">Change password</Submit>
    </form>
  );
}

export function NewApiKeyForm({ mcpUrl }: { mcpUrl: string }) {
  const [state, action] = useActionState(createApiKey, IDLE_API_KEY_STATE);
  const [copied, setCopied] = useState(false);
  return (
    <div className="api-key-new">
      <form action={action} className="api-key-form">
        <input name="name" placeholder="Key name, e.g. Claude desktop" maxLength={80} aria-label="Key name" />
        <Submit pendingLabel="Creating…">Create key</Submit>
      </form>
      {state.message && <p className="auth-banner">{state.message}</p>}
      {state.key && (
        <div className="api-key-reveal" role="status">
          <p>
            <strong>Copy this key now</strong> — it won&apos;t be shown again.
          </p>
          <div className="api-key-value">
            <code>{state.key}</code>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(state.key!);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="auth-hint">
            In your MCP client, add server <code>{mcpUrl}</code> with header{" "}
            <code>Authorization: Bearer {state.key.slice(0, 10)}…</code>
          </p>
        </div>
      )}
    </div>
  );
}

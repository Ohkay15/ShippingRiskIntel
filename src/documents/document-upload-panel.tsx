"use client";

import { useActionState } from "react";

import {
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABELS,
} from "@/documents/kinds";
import { IDLE_UPLOAD_STATE, type UploadState } from "@/documents/upload-state";

type UploadAction = (
  state: UploadState,
  formData: FormData
) => Promise<UploadState>;

export function DocumentUploadPanel({
  shipmentId,
  action,
}: {
  shipmentId: string;
  action: UploadAction;
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_UPLOAD_STATE
  );

  return (
    <section className="document-panel">
      <h2>Documents</h2>
      <form action={formAction} className="upload-row">
        <input type="hidden" name="shipmentId" value={shipmentId} />
        <label htmlFor="upload-kind">Document type</label>
        <select id="upload-kind" name="kind" defaultValue={DOCUMENT_KINDS[0]}>
          {DOCUMENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {DOCUMENT_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
        <label htmlFor="upload-file" className="visually-hidden">
          File
        </label>
        <input id="upload-file" name="file" type="file" required />
        <button type="submit" disabled={isPending}>
          {isPending ? "Uploading…" : "Upload"}
        </button>
      </form>
      {state.status === "error" && state.message && (
        <p className="field-error-message" role="alert">
          {state.message}
        </p>
      )}
      <p className="field-hint">
        Uploads are stored for extraction when the record is confirmed — an
        upload never scores or changes the record on its own.
      </p>
    </section>
  );
}

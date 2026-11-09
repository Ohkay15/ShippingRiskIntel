"use server";

import { redirect } from "next/navigation";

import { db } from "@/db";
import { shipmentDocuments } from "@/db/schema";
import { documentKindSchema } from "@/documents/kinds";
import { documentTextFromUpload } from "@/documents/document-text";
import type { UploadState } from "@/documents/upload-state";

/**
 * Store an uploaded source document against a shipment record. This only
 * persists the file and its extracted text — no field extraction or scoring
 * happens here. A human confirms the record first; extraction runs on
 * confirm (spec: "upload never auto-scores").
 */
export async function uploadDocument(
  shipmentId: string,
  _prev: UploadState,
  formData: FormData
): Promise<UploadState> {
  const kindRaw = formData.get("kind");
  const kind = documentKindSchema.safeParse(kindRaw);
  if (!kind.success) {
    return { status: "error", message: "Choose a document type." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a file to upload." };
  }

  try {
    const rawText = await documentTextFromUpload(file);
    await db.insert(shipmentDocuments).values({
      shipmentId,
      kind: kind.data,
      filename: file.name,
      mimeType: file.type || null,
      rawText,
    });
  } catch {
    return {
      status: "error",
      message: "The upload could not be stored. Try again.",
    };
  }

  redirect(`/shipments/${shipmentId}`);
}

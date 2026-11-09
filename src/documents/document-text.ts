/** Uploads above this size are rejected — MVP documents are a few KB of text. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * Read an uploaded document as text for LLM extraction.
 *
 * Postgres text columns cannot store NUL bytes, so they are stripped; the
 * rest of the text stays verbatim — evidence quotes must remain
 * checkable against the stored source. Binary formats (e.g. scanned PDFs)
 * yield lossy text at MVP scope: extraction on such input produces
 * low-confidence fields, which the confidence gate routes to review rather
 * than guessing. Real PDF/OCR parsing arrives with the live provider.
 */
export async function documentTextFromUpload(file: File): Promise<string> {
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new Error(`Document exceeds the ${MAX_DOCUMENT_BYTES}-byte limit`);
  }
  const raw = await file.text();
  return raw.replace(/\0/g, "");
}

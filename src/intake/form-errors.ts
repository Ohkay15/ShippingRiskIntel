import type { z } from "zod";

/** Flatten a Zod error into dotted field paths for form highlighting. */
export function fieldErrorsFromZod(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.errors) {
    const path = issue.path.map(String).join(".");
    // First issue per field wins; later duplicates add noise, not signal.
    fieldErrors[path] ??= issue.message;
  }
  return fieldErrors;
}

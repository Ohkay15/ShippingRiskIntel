import { FACTOR_GROUP_META, type FormFieldDef } from "./form-fields";

/**
 * Pure mapping from flat form wire format ("group.field" names) to the nested
 * intake payload the shared schema expects. Missing/empty values are omitted
 * entirely — the schema's nullable fields surface them downstream as
 * "unknown", never as a silent zero or a "no".
 */
export function intakePayloadFromFormData(
  formData: FormData
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const group of FACTOR_GROUP_META) {
    const groupPayload: Record<string, unknown> = {};
    for (const field of group.fields) {
      const value = readFieldValue(formData, field);
      if (value !== undefined) {
        groupPayload[leafName(field.path)] = value;
      }
    }
    if (Object.keys(groupPayload).length > 0) {
      payload[group.key] = groupPayload;
    }
  }

  return payload;
}

function leafName(path: string): string {
  const leaf = path.split(".")[1];
  if (!leaf) {
    throw new Error(`Malformed form field path: ${path}`);
  }
  return leaf;
}

function readFieldValue(
  formData: FormData,
  field: FormFieldDef
): unknown {
  switch (field.kind) {
    case "text": {
      const raw = formData.get(field.path);
      const text = typeof raw === "string" ? raw.trim() : "";
      return text === "" ? undefined : text;
    }
    case "number": {
      const raw = formData.get(field.path);
      const text = typeof raw === "string" ? raw.trim() : "";
      if (text === "") return undefined;
      // Invalid input is passed through as a string so the shared schema —
      // not the form layer — owns the rejection and its message.
      const parsed = Number(text);
      return Number.isNaN(parsed) ? text : parsed;
    }
    case "boolean": {
      const raw = formData.get(field.path);
      const text = typeof raw === "string" ? raw : "";
      if (text === "true") return true;
      if (text === "false") return false;
      return undefined;
    }
    case "enum": {
      const raw = formData.get(field.path);
      const text = typeof raw === "string" ? raw.trim() : "";
      return text === "" ? undefined : text;
    }
    case "multi": {
      const values = formData
        .getAll(field.path)
        .filter((v): v is string => typeof v === "string" && v.trim() !== "")
        .map((v) => v.trim());
      return values.length === 0 ? undefined : values;
    }
  }
}

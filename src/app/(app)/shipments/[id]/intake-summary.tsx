import type { ShipmentIntake } from "@/schemas/shipment";
import { FACTOR_GROUP_META, type FormFieldDef } from "@/intake/form-fields";

/**
 * Read-only rendering of the ten factor groups. Unknowns render as
 * "Unknown" — never as 0 or "No" — so a partially-filled record is
 * visually honest about what it doesn't know.
 */
export function IntakeSummary({ intake }: { intake: ShipmentIntake }) {
  return (
    <div className="factor-groups">
      {FACTOR_GROUP_META.map((group) => {
        const values = intake[group.key] as unknown as Record<string, unknown>;
        return (
          <section key={group.key} className="factor-card">
            <h3>
              {group.title}
              <span className="factor-source">{group.source}</span>
            </h3>
            <dl className="field-summary">
              {group.fields.map((field) => {
                const leaf = field.path.split(".")[1] ?? "";
                const value = values[leaf];
                return (
                  <div key={field.path} className="field-summary-row">
                    <dt>{field.label}</dt>
                    <dd>{renderValue(value, field.kind)}</dd>
                  </div>
                );
              })}
            </dl>
          </section>
        );
      })}
    </div>
  );
}

function renderValue(value: unknown, kind: FormFieldDef["kind"]): string {
  if (value == null) return "Unknown";
  if (kind === "boolean") return value === true ? "Yes" : "No";
  if (Array.isArray(value)) {
    return value.length === 0 ? "None reported" : value.map(String).join(", ");
  }
  return String(value);
}

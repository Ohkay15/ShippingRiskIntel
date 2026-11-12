/**
 * Plain-English labels for stored enum codes. Values in the database stay
 * as codes (the scoring contract); people only ever see these labels.
 */
const LABELS: Record<string, string> = {
  // hazard classes
  "1": "1 — Explosives",
  "2": "2 — Gases",
  "3": "3 — Flammable liquids",
  "4": "4 — Flammable solids",
  "5.1": "5.1 — Oxidizers",
  "5.2": "5.2 — Organic peroxides",
  "6.1": "6.1 — Toxic substances",
  "6.2": "6.2 — Infectious substances",
  "7": "7 — Radioactive",
  "8": "8 — Corrosives",
  "9": "9 — Miscellaneous (e.g. lithium batteries)",
  none: "Not hazardous",
  // modes
  road: "Road",
  rail: "Rail",
  ocean: "Ocean",
  air: "Air",
  intermodal: "Intermodal",
  // live conditions
  severe_weather: "Severe weather",
  port_congestion: "Port congestion",
  labor_disruption: "Labor disruption",
  customs_delay: "Customs delay",
  road_closure: "Road closure",
  none_reported: "None reported",
  // load type
  sealed_dedicated: "Sealed, dedicated truck",
  shared: "Shared (LTL / consolidated)",
  // fragility
  low: "Low",
  medium: "Medium",
  high: "High",
  ultra: "Very high",
  // delay sensitivity
  perishable: "Perishable",
  jit: "Just-in-time",
  flexible: "Flexible",
  // escalation
  contained: "Contained — loss stays with this load",
  spreads: "Spreads — can damage other cargo or property",
};

export function optionLabel(value: string): string {
  return LABELS[value] ?? value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

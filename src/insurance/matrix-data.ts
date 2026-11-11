import { insurerFitMatrixSchema, type InsurerFitMatrix } from "./schema";

/**
 * PLACEHOLDER insurer fit matrix.
 *
 * ⚠️ REPLACE ME: this seed is fictional placeholder content (generic
 * cargo insurance products, no real companies), written to make the
 * insurance recommendation engine demoable. Product names, hazard-class
 * appetite, lane coverage, limits, and liability terms are illustrative,
 * not verified quotes or binding terms. The owner replaces this table with
 * their own insurer seed (products, appetite, limits, terms) — the schema
 * in `schema.ts` is the contract; this file is the only thing to swap.
 */
export const PLACEHOLDER_INSURER_FIT_MATRIX: InsurerFitMatrix = insurerFitMatrixSchema.parse({
  sourceLabel:
    "Placeholder seed — fictional insurers' cargo offerings with illustrative attributes, pending owner's real insurer table",
  products: [
    {
      id: "insurer-a-marine-cargo",
      insurerName: "Insurer A",
      productName: "Marine Cargo",
      modes: ["ocean", "intermodal", "road", "rail"],
      supportedCargoTypes: ["general_dry", "perishable", "high_value_fragile"],
      supportedHazardClasses: ["none", "2", "3", "8", "9"],
      maxLaneRisk: "high",
      coverageLimitUsd: 1000000,
      liabilityTerms: "All-risk, warehouse-to-warehouse; per-conveyance deductible applies",
      notes:
        "Broad cargo book with high per-shipment limits and strong claims service — the general-purpose anchor product.",
    },
    {
      id: "insurer-b-cargo-plus",
      insurerName: "Insurer B",
      productName: "Cargo Plus",
      modes: ["road", "ocean", "air", "intermodal"],
      supportedCargoTypes: ["general_dry", "hazmat", "high_value_fragile"],
      supportedHazardClasses: ["none", "2", "3", "8", "9"],
      maxLaneRisk: "high",
      coverageLimitUsd: 500000,
      liabilityTerms: "All-risk with named-peril options; hazmat subject to underwriting referral",
      notes: "Global cargo capability with a dedicated hazmat underwriting practice.",
    },
    {
      id: "insurer-c-transport-solution",
      insurerName: "Insurer C",
      productName: "Transport & Cargo Solution",
      modes: ["road", "rail", "intermodal"],
      supportedCargoTypes: ["general_dry", "perishable", "high_value_fragile"],
      supportedHazardClasses: ["none", "2", "3", "9"],
      maxLaneRisk: "high",
      coverageLimitUsd: 750000,
      liabilityTerms: "All-risk inland/transit; temperature-deviation endorsement available",
      notes: "Inland transit strength with cold-chain endorsements for perishable loads.",
    },
    {
      id: "insurer-d-cargo",
      insurerName: "Insurer D",
      productName: "Cargo & Transport",
      modes: ["road", "ocean", "rail"],
      supportedCargoTypes: ["general_dry", "hazmat", "perishable"],
      supportedHazardClasses: ["none", "3", "8"],
      maxLaneRisk: "medium",
      coverageLimitUsd: 400000,
      liabilityTerms: "Institute Cargo Clauses (A) basis; corrosives and flammables referred",
      notes: "Mid-market cargo product on a container-liability base.",
    },
    {
      id: "insurer-e-inland-marine",
      insurerName: "Insurer E",
      productName: "Inland Marine Cargo",
      modes: ["road"],
      supportedCargoTypes: ["general_dry"],
      supportedHazardClasses: ["none"],
      maxLaneRisk: "low",
      coverageLimitUsd: 250000,
      liabilityTerms: "Named-peril inland transit; scheduled cargo only",
      notes: "Straightforward low-risk dry-goods transit cover on domestic road lanes.",
    },
    {
      id: "insurer-f-high-value",
      insurerName: "Insurer F",
      productName: "Cargo Specie & High-Value",
      modes: ["ocean", "air", "intermodal"],
      supportedCargoTypes: ["general_dry", "high_value_fragile"],
      supportedHazardClasses: ["none", "3", "9"],
      maxLaneRisk: "medium",
      coverageLimitUsd: 2000000,
      liabilityTerms: "All-risk, agreed-value basis for high-value consignments",
      notes: "Specialty limits for high-value consignments where standard markets cap out.",
    },
    {
      id: "insurer-g-transit-cargo",
      insurerName: "Insurer G",
      productName: "Transit Cargo",
      modes: ["road", "rail"],
      supportedCargoTypes: ["general_dry", "hazmat", "perishable"],
      supportedHazardClasses: ["none", "2", "3", "8", "9"],
      maxLaneRisk: "high",
      coverageLimitUsd: 300000,
      liabilityTerms: "All-risk transit with dedicated hazmat and reefer endorsements",
      notes: "Domestic truckload and rail transit with hazmat and reefer endorsements.",
    },
  ],
});

import { carrierFitMatrixSchema, type CarrierFitMatrix } from "./schema";

/**
 * PLACEHOLDER carrier fit matrix.
 *
 * ⚠️ REPLACE ME: this seed is fictional placeholder content (generic
 * carrier profiles, no real companies), written to make the recommendation engine demoable.
 * Ratings, liability limits, and insurance figures are illustrative, not
 * verified. The owner replaces this table with their own carrier seed
 * (equipment, hazmat endorsements, lanes, claims record) — the schema in
 * `schema.ts` is the contract; this file is the only thing to swap.
 */
export const PLACEHOLDER_CARRIER_FIT_MATRIX: CarrierFitMatrix = carrierFitMatrixSchema.parse({
  sourceLabel:
    "Placeholder seed — fictional carriers with illustrative attributes, pending owner's real carrier table",
  carriers: [
    {
      id: "carrier-a",
      name: "Carrier A — National LTL",
      modes: ["road", "intermodal"],
      supportedCargoTypes: ["general_dry", "high_value_fragile"],
      maxLaneRisk: "medium",
      liabilityLimitUsd: 100000,
      insuranceOfferingUsd: 150000,
      safetyRating: 1,
      claimsRating: 1,
      notes: "National LTL carrier with a top-tier safety and claims record.",
    },
    {
      id: "carrier-b",
      name: "Carrier B — Multimodal LTL",
      modes: ["road", "intermodal", "air"],
      supportedCargoTypes: ["general_dry", "perishable", "high_value_fragile"],
      maxLaneRisk: "medium",
      liabilityLimitUsd: 50000,
      insuranceOfferingUsd: 100000,
      safetyRating: 1,
      claimsRating: 2,
      notes: "LTL network with cold-chain and expedite options via an affiliated parcel network.",
    },
    {
      id: "carrier-c",
      name: "Carrier C — Regional LTL",
      modes: ["road"],
      supportedCargoTypes: ["general_dry", "high_value_fragile"],
      maxLaneRisk: "low",
      liabilityLimitUsd: 50000,
      insuranceOfferingUsd: null,
      safetyRating: 2,
      claimsRating: 2,
      notes: "Regional LTL strength on eastern US lanes.",
    },
    {
      id: "carrier-d",
      name: "Carrier D — North American LTL",
      modes: ["road", "intermodal"],
      supportedCargoTypes: ["general_dry"],
      maxLaneRisk: "medium",
      liabilityLimitUsd: 50000,
      insuranceOfferingUsd: null,
      safetyRating: 2,
      claimsRating: 3,
      notes: "North American LTL with broad door coverage.",
    },
    {
      id: "carrier-e",
      name: "Carrier E — Truckload & Intermodal",
      modes: ["road", "intermodal", "rail"],
      supportedCargoTypes: ["general_dry", "hazmat"],
      maxLaneRisk: "high",
      hazmatCertifications: ["HM-licensed drivers", "bulk/tank carrier certification"],
      liabilityLimitUsd: 100000,
      insuranceOfferingUsd: 100000,
      safetyRating: 2,
      claimsRating: 2,
      notes: "Large truckload and intermodal carrier with a long-established hazmat practice.",
    },
    {
      id: "carrier-f",
      name: "Carrier F — Container Intermodal",
      modes: ["road", "intermodal", "rail"],
      supportedCargoTypes: ["general_dry"],
      maxLaneRisk: "high",
      liabilityLimitUsd: 100000,
      insuranceOfferingUsd: null,
      safetyRating: 2,
      claimsRating: 3,
      notes: "Container intermodal at scale on major US rail corridors.",
    },
    {
      id: "carrier-g",
      name: "Carrier G — OTR Truckload",
      modes: ["road"],
      supportedCargoTypes: ["general_dry", "hazmat"],
      maxLaneRisk: "high",
      hazmatCertifications: ["HM-licensed drivers"],
      liabilityLimitUsd: 100000,
      insuranceOfferingUsd: null,
      safetyRating: 3,
      claimsRating: 3,
      notes: "Over-the-road truckload with hazmat-endorsed fleets.",
    },
    {
      id: "carrier-h",
      name: "Carrier H — Truckload & Reefer",
      modes: ["road"],
      supportedCargoTypes: ["general_dry", "hazmat", "perishable"],
      maxLaneRisk: "high",
      hazmatCertifications: ["HM-licensed drivers", "reefer and temperature-controlled fleet"],
      liabilityLimitUsd: 100000,
      insuranceOfferingUsd: null,
      safetyRating: 3,
      claimsRating: 3,
      notes: "Large truckload fleet including temperature-controlled and hazmat divisions.",
    },
  ],
});

import { carrierFitMatrixSchema, type CarrierFitMatrix } from "./schema";

/**
 * PLACEHOLDER carrier fit matrix.
 *
 * ⚠️ REPLACE ME: this seed is placeholder content from public knowledge of
 * major US carriers, written to make the recommendation engine demoable.
 * Ratings, liability limits, and insurance figures are illustrative, not
 * verified. The owner replaces this table with their own carrier seed
 * (equipment, hazmat endorsements, lanes, claims record) — the schema in
 * `schema.ts` is the contract; this file is the only thing to swap.
 */
export const PLACEHOLDER_CARRIER_FIT_MATRIX: CarrierFitMatrix = carrierFitMatrixSchema.parse({
  sourceLabel:
    "Placeholder seed — public-knowledge US carriers with illustrative attributes, pending owner's real carrier table",
  carriers: [
    {
      id: "odfl",
      name: "Old Dominion Freight Line",
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
      id: "fedex-freight",
      name: "FedEx Freight",
      modes: ["road", "intermodal", "air"],
      supportedCargoTypes: ["general_dry", "perishable", "high_value_fragile"],
      maxLaneRisk: "medium",
      liabilityLimitUsd: 50000,
      insuranceOfferingUsd: 100000,
      safetyRating: 1,
      claimsRating: 2,
      notes: "LTL network with cold-chain and expedite options via the FedEx family.",
    },
    {
      id: "estes",
      name: "Estes Express Lines",
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
      id: "xpo",
      name: "XPO Logistics",
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
      id: "schneider",
      name: "Schneider National",
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
      id: "jb-hunt",
      name: "J.B. Hunt Transport Services",
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
      id: "werner",
      name: "Werner Enterprises",
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
      id: "knight-swift",
      name: "Knight-Swift Transportation",
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

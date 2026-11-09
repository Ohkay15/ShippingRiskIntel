import { shipmentIntakeSchema, type ShipmentIntake } from "../schemas/shipment";
import { DEFAULT_SCORING_CONFIG, type ScoringConfig } from "./config";
import { score, type RiskProfile } from "./engine";

/**
 * Synthetic shipment dataset — the calibration and demo corpus for the
 * scoring engine (spec Phase 1). ~40 records spanning the full risk matrix:
 * clean dry goods at LL through DG-class cargo with expired certs, shared
 * loads, and under-coverage at HH.
 *
 * Corridor: intra-US dry goods + hazmat mix. This is a LABELED DEFAULT —
 * the owner has not yet chosen the pilot corridor/cargo mix (spec open
 * question), so every lane is domestic US and the carrier table is
 * placeholder seed data, not real carriers.
 */

export const SYNTHETIC_DATASET_CORRIDOR =
  "Default corridor: intra-US dry goods + hazmat mix — labeled default pending owner input";

export interface SyntheticShipment {
  /** Stable dataset id (SH-001 … SH-040). */
  id: string;
  /** One-line scenario intent — the hand-review record for this build. */
  label: string;
  record: ShipmentIntake;
}

export interface ScoredSyntheticShipment extends SyntheticShipment {
  profile: RiskProfile;
}

// ---------------------------------------------------------------------------
// Seed lookup tables (placeholder content pending owner input)
// ---------------------------------------------------------------------------

const LANES = {
  il_oh: { origin: "Chicago, IL", destination: "Columbus, OH", mode: "road", laneId: "US-IL-OH-05" },
  il_tx: { origin: "Chicago, IL", destination: "Dallas, TX", mode: "road", laneId: "US-IL-TX-01" },
  ga_fl: { origin: "Atlanta, GA", destination: "Miami, FL", mode: "road", laneId: "US-GA-FL-04" },
  nj_il: { origin: "Newark, NJ", destination: "Chicago, IL", mode: "road", laneId: "US-NJ-IL-03" },
  ca_tx: { origin: "Los Angeles, CA", destination: "Houston, TX", mode: "road", laneId: "US-CA-TX-02" },
  ca_wa: { origin: "Oakland, CA", destination: "Seattle, WA", mode: "road", laneId: "US-CA-WA-06" },
  il_tx_multi: {
    origin: "Chicago, IL",
    destination: "Dallas, TX",
    mode: "intermodal",
    laneId: "US-IL-TX-IM-01",
  },
  ga_fl_multi: {
    origin: "Atlanta, GA",
    destination: "Miami, FL",
    mode: "intermodal",
    laneId: "US-GA-FL-IM-01",
  },
  nj_il_multi: {
    origin: "Newark, NJ",
    destination: "Chicago, IL",
    mode: "intermodal",
    laneId: "US-NJ-IL-IM-01",
  },
  ca_tx_multi: {
    origin: "Los Angeles, CA",
    destination: "Houston, TX",
    mode: "intermodal",
    laneId: "US-CA-TX-IM-01",
  },
} as const satisfies Record<string, ShipmentIntake["route_lane"]>;

const CARRIERS = {
  /** Placeholder seed carriers — real fit-matrix content comes from the owner. */
  heartland: {
    carrierId: "car-001",
    carrierName: "Heartland Freight Lines",
    carrierSafetyRating: 1,
    carrierClaimsRating: 1,
  },
  midwest: {
    carrierId: "car-014",
    carrierName: "Midwest Freight Lines",
    carrierSafetyRating: 2,
    carrierClaimsRating: 2,
  },
  blue_ridge: {
    carrierId: "car-027",
    carrierName: "Blue Ridge Transport",
    carrierSafetyRating: 3,
    carrierClaimsRating: 3,
  },
  coastal: {
    carrierId: "car-055",
    carrierName: "Coastal Cartage",
    carrierSafetyRating: 4,
    carrierClaimsRating: 3,
  },
  redline: {
    carrierId: "car-042",
    carrierName: "Redline Overnight",
    carrierSafetyRating: 5,
    carrierClaimsRating: 5,
  },
} as const satisfies Record<string, ShipmentIntake["carrier_record"]>;

const CARGO = {
  water: { cargoDescription: "Bottled water, palletized", hsCode: "2201.10", unNumber: null, hazardClass: "none" },
  towels: { cargoDescription: "Paper towels, case-packed", hsCode: "4818.30", unNumber: null, hazardClass: "none" },
  footwear: { cargoDescription: "Athletic footwear", hsCode: "6404.11", unNumber: null, hazardClass: "none" },
  fasteners: { cargoDescription: "Automotive fasteners", hsCode: "7318.15", unNumber: null, hazardClass: "none" },
  furniture: { cargoDescription: "Flat-pack furniture", hsCode: "9403.60", unNumber: null, hazardClass: "none" },
  electronics: { cargoDescription: "Boxed consumer electronics", hsCode: "8471.30", unNumber: null, hazardClass: "none" },
  glassware: { cargoDescription: "Commercial glassware, crated", hsCode: "7010.90", unNumber: null, hazardClass: "none" },
  produce: { cargoDescription: "Berries, refrigerated", hsCode: "0810.20", unNumber: null, hazardClass: "none" },
  pharma: {
    cargoDescription: "Temperature-controlled pharmaceuticals",
    hsCode: "3004.90",
    unNumber: null,
    hazardClass: "none",
  },
  acetone: { cargoDescription: "Acetone, 55-gal steel drums", hsCode: "2914.11", unNumber: "UN1090", hazardClass: "3" },
  lithium: { cargoDescription: "Lithium-ion battery packs", hsCode: "8507.60", unNumber: "UN3480", hazardClass: "9" },
  caustic: {
    cargoDescription: "Sodium hydroxide solution",
    hsCode: "2815.12",
    unNumber: "UN1824",
    hazardClass: "8",
  },
  corrosive: {
    cargoDescription: "Corrosive cleaning agents",
    hsCode: "3402.50",
    unNumber: "UN1760",
    hazardClass: "8",
  },
  propane: { cargoDescription: "Propane cylinders", hsCode: "2711.12", unNumber: "UN1978", hazardClass: "2" },
  ammonium: {
    cargoDescription: "Ammonium nitrate fertilizer",
    hsCode: "3102.50",
    unNumber: "UN1942",
    hazardClass: "5.1",
  },
} as const satisfies Record<string, ShipmentIntake["cargo_hazard"]>;

// ---------------------------------------------------------------------------
// Patch helpers — group-level overrides over the clean base record
// ---------------------------------------------------------------------------

type RecordPatch = Partial<ShipmentIntake>;

const moving = (lane: keyof typeof LANES): RecordPatch => ({ route_lane: LANES[lane] });
const shippedBy = (carrier: keyof typeof CARRIERS): RecordPatch => ({ carrier_record: CARRIERS[carrier] });
const valued = (declaredValueUsd: number, fragilityClass: "low" | "medium" | "high" | "ultra"): RecordPatch => ({
  value_fragility: { declaredValueUsd, fragilityClass },
});
const certified = (options: { packingType?: string; ispm?: boolean; dg?: boolean; expiry?: string }): RecordPatch => ({
  packing_certs: {
    packingType: options.packingType ?? "Palletized, shrink-wrapped",
    ispm15CertPresent: options.ispm ?? true,
    dgCertPresent: options.dg ?? false,
    certExpiryDate: options.expiry ?? null,
  },
});
const disrupted = (...conditions: ShipmentIntake["live_conditions"]["conditions"]): RecordPatch => ({
  live_conditions: { conditions, notes: null },
});
const shared = (handlingPoints: number): RecordPatch => ({
  load_type: { loadType: "shared", handlingPoints },
});
const covered = (insuranceCoverageUsd: number | null, carrierLiabilityLimitUsd: number | null): RecordPatch => ({
  coverage: { insuranceCoverageUsd, carrierLiabilityLimitUsd },
});
const withoutCoverage = covered(null, null);
const sensitive = (delaySensitivity: "perishable" | "jit" | "flexible"): RecordPatch => ({
  sensitivity: { delaySensitivity },
});
const spreading = (): RecordPatch => ({
  escalation: { escalationExposure: "spreads", escalationContact: "ops@shiprisk.example" },
});

const BASE: ShipmentIntake = shipmentIntakeSchema.parse({
  cargo_hazard: CARGO.water,
  packing_certs: {
    packingType: "Palletized, shrink-wrapped",
    ispm15CertPresent: true,
    dgCertPresent: false,
    certExpiryDate: null,
  },
  carrier_record: CARRIERS.heartland,
  route_lane: LANES.il_oh,
  live_conditions: { conditions: ["none_reported"], notes: null },
  load_type: { loadType: "sealed_dedicated", handlingPoints: 0 },
  value_fragility: { declaredValueUsd: 90000, fragilityClass: "low" },
  sensitivity: { delaySensitivity: "flexible" },
  escalation: { escalationExposure: "contained", escalationContact: "ops@shiprisk.example" },
  coverage: { insuranceCoverageUsd: 150000, carrierLiabilityLimitUsd: 150000 },
});

/** Parse the merged record at definition time — an invalid scenario fails at import. */
function defineShipment(id: string, label: string, patch: RecordPatch): SyntheticShipment {
  return { id, label, record: shipmentIntakeSchema.parse({ ...BASE, ...patch }) };
}

// ---------------------------------------------------------------------------
// The dataset — grouped by intended matrix cell
// ---------------------------------------------------------------------------

const SCENARIOS: SyntheticShipment[] = [
  // --- LL (12): clean dry goods, solid carrier, dedicated, fully covered, clear lane.
  defineShipment("SH-001", "Bottled water, best carrier, short lane, flexible — deep LL", {
    ...moving("il_oh"),
  }),
  defineShipment("SH-002", "Paper towels, best carrier, JIT — clean and routine", {
    ...moving("ga_fl"),
    ...sensitive("jit"),
  }),
  defineShipment("SH-003", "Footwear, good carrier, long haul — clean", {
    ...shippedBy("midwest"),
    ...moving("il_tx"),
    ...valued(85000, "low"),
  }),
  defineShipment("SH-004", "Fasteners, good carrier, short lane — clean", {
    ...shippedBy("midwest"),
    ...valued(70000, "low"),
  }),
  defineShipment("SH-005", "Flat-pack furniture, west-coast lane — clean", {
    ...shippedBy("midwest"),
    ...moving("ca_wa"),
    ...valued(95000, "medium"),
  }),
  defineShipment("SH-006", "Electronics, best carrier, JIT — clean", {
    ...valued(90000, "medium"),
    ...sensitive("jit"),
  }),
  defineShipment("SH-007", "Paper towels, good carrier — clean", {
    ...shippedBy("midwest"),
    ...moving("ga_fl"),
    ...valued(55000, "low"),
  }),
  defineShipment("SH-008", "Electronics, good carrier, transcontinental — clean", {
    ...shippedBy("midwest"),
    ...moving("nj_il"),
    ...valued(95000, "medium"),
    ...sensitive("jit"),
  }),
  defineShipment("SH-009", "Furniture, best carrier — clean", {
    ...valued(98000, "medium"),
  }),
  defineShipment("SH-010", "Bottled water, good carrier, west lane — clean", {
    ...shippedBy("midwest"),
    ...moving("ca_tx"),
    ...valued(88000, "low"),
  }),
  defineShipment("SH-011", "Footwear, best carrier, transcontinental — clean", {
    ...moving("nj_il"),
    ...sensitive("jit"),
    ...valued(75000, "low"),
  }),
  defineShipment("SH-012", "Fasteners, best carrier, west lane — clean", {
    ...moving("ca_tx"),
    ...valued(65000, "low"),
  }),

  // --- LH (8): dry goods with stacked operational friction — delays likely, harm contained.
  defineShipment("SH-013", "Furniture, no ISPM, intermodal, congestion, shared 2-handoff, JIT", {
    cargo_hazard: CARGO.furniture,
    ...certified({ ispm: false, packingType: "Crated" }),
    ...shippedBy("midwest"),
    ...moving("il_tx_multi"),
    ...disrupted("port_congestion"),
    ...shared(2),
    ...valued(85000, "medium"),
    ...sensitive("jit"),
  }),
  defineShipment("SH-014", "Paper towels, no ISPM, intermodal, congestion, shared, JIT", {
    ...certified({ ispm: false }),
    ...shippedBy("midwest"),
    ...moving("ga_fl_multi"),
    ...disrupted("port_congestion"),
    ...shared(2),
    ...valued(60000, "low"),
    ...sensitive("jit"),
  }),
  defineShipment("SH-015", "Footwear, no ISPM, intermodal, congestion + labor, shared, JIT", {
    ...certified({ ispm: false }),
    ...moving("nj_il_multi"),
    ...disrupted("port_congestion", "labor_disruption"),
    ...shared(2),
    ...valued(75000, "low"),
    ...sensitive("jit"),
  }),
  defineShipment("SH-016", "Electronics, no ISPM, congestion, shared, JIT", {
    ...certified({ ispm: false }),
    ...shippedBy("midwest"),
    ...moving("nj_il"),
    ...disrupted("port_congestion"),
    ...shared(2),
    ...valued(90000, "medium"),
    ...sensitive("jit"),
  }),
  defineShipment("SH-017", "Paper towels, no ISPM, intermodal, congestion, shared, JIT", {
    ...certified({ ispm: false }),
    ...moving("il_tx_multi"),
    ...disrupted("port_congestion"),
    ...shared(2),
    ...sensitive("jit"),
    ...valued(60000, "low"),
  }),
  defineShipment("SH-018", "Fasteners, no ISPM, congestion, shared, JIT", {
    ...certified({ ispm: false }),
    ...shippedBy("midwest"),
    ...moving("il_tx"),
    ...disrupted("port_congestion"),
    ...shared(2),
    ...valued(70000, "low"),
    ...sensitive("jit"),
  }),
  defineShipment("SH-019", "Footwear, no ISPM, intermodal, labor, shared, JIT", {
    ...certified({ ispm: false }),
    ...moving("ca_tx_multi"),
    ...disrupted("labor_disruption"),
    ...shared(2),
    ...sensitive("jit"),
  }),
  defineShipment("SH-020", "Bottled water, no ISPM, congestion, shared, JIT", {
    ...certified({ ispm: false }),
    ...shippedBy("midwest"),
    ...moving("ca_tx"),
    ...disrupted("port_congestion"),
    ...shared(2),
    ...valued(88000, "low"),
    ...sensitive("jit"),
  }),

  // --- HL (8): high consequence (hazmat or high value), cleanly executed — unlikely, severe.
  defineShipment("SH-021", "Lithium batteries, certified, best carrier, dedicated, clear — controlled hazmat", {
    cargo_hazard: CARGO.lithium,
    ...certified({ dg: true, packingType: "UN-rated cartons" }),
    ...moving("il_tx"),
    ...sensitive("jit"),
    ...valued(70000, "low"),
  }),
  defineShipment("SH-022", "Sodium hydroxide, certified, best carrier, dedicated — controlled hazmat", {
    cargo_hazard: CARGO.caustic,
    ...certified({ dg: true, packingType: "Steel drums, palletized" }),
    ...moving("ga_fl"),
    ...valued(65000, "low"),
  }),
  defineShipment("SH-023", "Propane cylinders, certified, best carrier, dedicated — controlled gas", {
    cargo_hazard: CARGO.propane,
    ...certified({ dg: true, packingType: "Secured cylinder racks" }),
    ...moving("nj_il"),
    ...valued(60000, "low"),
  }),
  defineShipment("SH-024", "Electronics, $150k, best carrier, fully covered — high value", {
    ...valued(150000, "medium"),
    ...covered(160000, 160000),
  }),
  defineShipment("SH-025", "Glassware, $140k fragile, best carrier, fully covered — fragile high value", {
    cargo_hazard: CARGO.glassware,
    ...certified({ packingType: "Foam-lined crates" }),
    ...valued(140000, "high"),
  }),
  defineShipment("SH-026", "Pharmaceuticals, $180k, JIT, best carrier, fully covered", {
    cargo_hazard: CARGO.pharma,
    ...moving("nj_il"),
    ...sensitive("jit"),
    ...valued(180000, "medium"),
    ...covered(200000, 200000),
  }),
  defineShipment("SH-027", "Acetone, certified, best carrier — coverage data missing (unknown gap)", {
    cargo_hazard: CARGO.acetone,
    ...certified({ dg: true, packingType: "Steel drums, palletized" }),
    ...moving("ga_fl"),
    ...valued(58000, "low"),
    ...withoutCoverage,
  }),
  defineShipment("SH-028", "Ammonium nitrate, certified, best carrier, dedicated — controlled oxidizer", {
    cargo_hazard: CARGO.ammonium,
    ...certified({ dg: true, packingType: "Sealed bags, palletized" }),
    ...moving("il_tx"),
    ...valued(55000, "low"),
  }),

  // --- HH (12): stacked hazards — uncertified/expired DG, weak carriers, shared loads,
  // live disruptions, thin coverage.
  defineShipment("SH-029", "Acetone, NO DG cert, worst carrier, severe weather, 4 handoffs, fragile high value, half covered", {
    cargo_hazard: CARGO.acetone,
    ...certified({ dg: false, packingType: "Steel drums, palletized" }),
    ...shippedBy("redline"),
    ...moving("ca_tx"),
    ...disrupted("severe_weather"),
    ...shared(4),
    ...valued(180000, "high"),
    ...sensitive("jit"),
    ...spreading(),
    ...covered(90000, 90000),
  }),
  defineShipment("SH-030", "Sodium hydroxide, EXPIRED cert, mediocre carrier, congestion, shared, thin cover", {
    cargo_hazard: CARGO.caustic,
    ...certified({ dg: true, expiry: "2025-06-30", packingType: "Steel drums, palletized" }),
    ...shippedBy("blue_ridge"),
    ...moving("ga_fl"),
    ...disrupted("port_congestion"),
    ...shared(2),
    ...valued(95000, "medium"),
    ...sensitive("jit"),
    ...spreading(),
    ...covered(60000, 80000),
  }),
  defineShipment("SH-031", "Lithium batteries, NO DG cert, worst carrier, congestion, 4 handoffs, half covered", {
    cargo_hazard: CARGO.lithium,
    ...certified({ dg: false, packingType: "UN-rated cartons" }),
    ...shippedBy("redline"),
    ...moving("nj_il"),
    ...disrupted("port_congestion"),
    ...shared(4),
    ...valued(88000, "medium"),
    ...sensitive("jit"),
    ...spreading(),
    ...covered(50000, 100000),
  }),
  defineShipment("SH-032", "Propane, EXPIRED cert, weak carrier, severe weather, shared, thin cover", {
    cargo_hazard: CARGO.propane,
    ...certified({ dg: true, expiry: "2025-06-30", packingType: "Secured cylinder racks" }),
    ...shippedBy("coastal"),
    ...moving("il_tx"),
    ...disrupted("severe_weather"),
    ...shared(2),
    ...valued(70000, "low"),
    ...sensitive("jit"),
    ...spreading(),
    ...covered(40000, 60000),
  }),
  defineShipment("SH-033", "Ammonium nitrate, worst carrier, congestion, 4 handoffs, thin cover", {
    cargo_hazard: CARGO.ammonium,
    ...certified({ dg: true, packingType: "Sealed bags, palletized" }),
    ...shippedBy("redline"),
    ...moving("il_tx"),
    ...disrupted("port_congestion"),
    ...shared(4),
    ...valued(120000, "medium"),
    ...sensitive("jit"),
    ...spreading(),
    ...covered(80000, 100000),
  }),
  defineShipment("SH-034", "Acetone, NO DG cert, mediocre carrier, shared, thin cover", {
    cargo_hazard: CARGO.acetone,
    ...certified({ dg: false, packingType: "Steel drums, palletized" }),
    ...shippedBy("blue_ridge"),
    ...moving("ga_fl"),
    ...shared(2),
    ...valued(65000, "low"),
    ...sensitive("jit"),
    ...spreading(),
    ...covered(35000, 60000),
  }),
  defineShipment("SH-035", "Pharma $300k fragile, congestion, perishable, spreads, half covered", {
    cargo_hazard: CARGO.pharma,
    ...shippedBy("midwest"),
    ...moving("nj_il"),
    ...disrupted("port_congestion"),
    ...valued(300000, "high"),
    ...sensitive("perishable"),
    ...spreading(),
    ...covered(150000, 200000),
  }),
  defineShipment("SH-036", "Electronics $400k ultra-fragile, severe weather, shared, thin cover", {
    ...shippedBy("midwest"),
    ...moving("ca_tx"),
    ...disrupted("severe_weather"),
    ...shared(2),
    ...valued(400000, "ultra"),
    ...sensitive("jit"),
    ...covered(250000, 250000),
  }),
  defineShipment("SH-037", "Acetone, EXPIRED cert, weak carrier, congestion, 4 handoffs, thin cover", {
    cargo_hazard: CARGO.acetone,
    ...certified({ dg: true, expiry: "2025-06-30", packingType: "Steel drums, palletized" }),
    ...shippedBy("coastal"),
    ...moving("ca_wa"),
    ...disrupted("port_congestion"),
    ...shared(4),
    ...valued(75000, "low"),
    ...sensitive("jit"),
    ...spreading(),
    ...covered(40000, 80000),
  }),
  defineShipment("SH-038", "Lithium batteries, NO DG cert, weak carrier, road closure — coverage unknown", {
    cargo_hazard: CARGO.lithium,
    ...certified({ dg: false, packingType: "UN-rated cartons" }),
    ...shippedBy("coastal"),
    ...moving("ca_wa"),
    ...disrupted("road_closure"),
    ...shared(2),
    ...valued(80000, "medium"),
    ...sensitive("jit"),
    ...spreading(),
    ...withoutCoverage,
  }),
  defineShipment("SH-039", "Sodium hydroxide, NO DG cert, worst carrier, severe weather, 4 handoffs, half covered", {
    cargo_hazard: CARGO.caustic,
    ...certified({ dg: false, packingType: "Steel drums, palletized" }),
    ...shippedBy("redline"),
    ...moving("il_tx"),
    ...disrupted("severe_weather"),
    ...shared(4),
    ...valued(110000, "medium"),
    ...sensitive("jit"),
    ...spreading(),
    ...covered(50000, 90000),
  }),
  defineShipment("SH-040", "Corrosive cleaning agents, NO DG cert, worst carrier, congestion, 4 handoffs, thin cover", {
    cargo_hazard: CARGO.corrosive,
    ...certified({ dg: false, packingType: "Plastic drums, palletized" }),
    ...shippedBy("redline"),
    ...moving("ga_fl"),
    ...disrupted("port_congestion"),
    ...shared(4),
    ...valued(85000, "medium"),
    ...sensitive("jit"),
    ...spreading(),
    ...covered(40000, 70000),
  }),
];

export const syntheticShipments: readonly SyntheticShipment[] = SCENARIOS;

/** Score the whole corpus with a config — deterministic by construction. */
export function scoreSyntheticDataset(
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): ScoredSyntheticShipment[] {
  return SCENARIOS.map((entry) => ({ ...entry, profile: score(entry.record, config) }));
}

/**
 * Integration chassis — shared vocabulary.
 *
 * Every external system the product can talk to is described once in the
 * catalog (catalog.ts) and reached only through a capability interface
 * (carrier data, insurance quotes, CRM, notifications, shipping rates…).
 * Call sites ask for a capability, never for a vendor, so adding a vendor
 * is a new adapter plus environment variables — no call-site changes.
 *
 * Activation rule, everywhere: an adapter is live when its required
 * environment variables are present; otherwise the capability falls back
 * to a deterministic mock so the app always works end to end.
 */

export const CONNECTOR_CATEGORIES = [
  "ai",
  "carrier_data",
  "insurance",
  "shipping",
  "tms",
  "visibility",
  "crm",
  "erp",
  "payments",
  "messaging",
  "automation",
] as const;
export type ConnectorCategory = (typeof CONNECTOR_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ConnectorCategory, string> = {
  ai: "AI models",
  carrier_data: "Carrier safety & vetting",
  insurance: "Cargo insurance",
  shipping: "Parcel & freight rates",
  tms: "Transportation management (TMS)",
  visibility: "Shipment visibility",
  crm: "CRM",
  erp: "ERP & accounting",
  payments: "Payments & billing",
  messaging: "Team messaging",
  automation: "Webhooks & automation",
};

/**
 * How access to the vendor's API is obtained.
 * - public: free self-registration (e.g. a government web key).
 * - self_serve: create an account, generate a key.
 * - partner: requires a partnership agreement and the vendor's private docs.
 */
export type ConnectorAccess = "public" | "self_serve" | "partner";

/**
 * How far the adapter is built.
 * - live: adapter implemented against the vendor's public API; adding the
 *   env vars switches it on.
 * - partner_pending: adapter slot, mapping and env wiring exist; the request
 *   format is finalized once the partner shares its API contract.
 * - planned: listed in the catalog, adapter not started.
 */
export type ConnectorImplementation = "live" | "partner_pending" | "planned";

export interface ConnectorDef {
  id: string;
  name: string;
  category: ConnectorCategory;
  /** One line: what it does for this product. */
  summary: string;
  access: ConnectorAccess;
  implementation: ConnectorImplementation;
  /** Every one of these must be set for the connector to be active. */
  requiredEnv: readonly string[];
  /** Tuning knobs (model names, base URLs) with sensible defaults. */
  optionalEnv?: readonly string[];
  /** What part of the product the connector feeds. */
  powers: string;
  docsUrl?: string;
}

/**
 * Display status, derived from the catalog entry plus the environment.
 * - connected: live adapter with every required env var present.
 * - add_key: live adapter built, waiting on its env vars.
 * - keys_set_pending_contract: partner env vars present, adapter awaiting
 *   the partner's API contract.
 * - partner_access: partner agreement needed before keys exist.
 * - planned: catalogued only.
 */
export type ConnectorStatus =
  | "connected"
  | "add_key"
  | "keys_set_pending_contract"
  | "partner_access"
  | "planned";

/** Read-only view of the environment, injectable so tests never touch process.env. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Thrown by a partner adapter whose API contract has not been wired yet. */
export class PartnerContractPendingError extends Error {
  constructor(public readonly connectorId: string) {
    super(
      `${connectorId}: credentials are set, but this partner's API contract has not been wired yet. ` +
        "The mock remains active until the adapter's request mapping is completed from the partner's docs."
    );
    this.name = "PartnerContractPendingError";
  }
}

/** Thrown when a live adapter's upstream call fails. */
export class IntegrationRequestError extends Error {
  constructor(
    public readonly connectorId: string,
    message: string,
    public readonly status?: number
  ) {
    super(`${connectorId}: ${message}`);
    this.name = "IntegrationRequestError";
  }
}

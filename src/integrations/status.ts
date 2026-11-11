import { CONNECTORS } from "./catalog";
import {
  CONNECTOR_CATEGORIES,
  type ConnectorCategory,
  type ConnectorDef,
  type ConnectorStatus,
  type EnvSource,
} from "./types";

/** The live process environment (server only). Tests pass their own. */
export function processEnv(): EnvSource {
  return process.env;
}

/** A value counts as set only when it has non-whitespace content. */
export function envValue(env: EnvSource, name: string): string | undefined {
  const value = env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

export function hasEnv(env: EnvSource, names: readonly string[]): boolean {
  return names.every((name) => envValue(env, name) !== undefined);
}

export function connectorStatus(def: ConnectorDef, env: EnvSource): ConnectorStatus {
  const keysSet = hasEnv(env, def.requiredEnv);
  switch (def.implementation) {
    case "live":
      return keysSet ? "connected" : "add_key";
    case "partner_pending":
      return keysSet ? "keys_set_pending_contract" : "partner_access";
    case "planned":
      return "planned";
  }
}

export function isConnected(id: string, env: EnvSource): boolean {
  const def = CONNECTORS.find((c) => c.id === id);
  return def !== undefined && connectorStatus(def, env) === "connected";
}

export interface ConnectorStatusView {
  def: ConnectorDef;
  status: ConnectorStatus;
  /** Required env vars not yet set — what the operator adds in Vercel. */
  missingEnv: string[];
}

export interface CategoryStatusView {
  category: ConnectorCategory;
  connectors: ConnectorStatusView[];
}

/** Every connector with its status, grouped by category in catalog order. */
export function integrationStatusReport(env: EnvSource): CategoryStatusView[] {
  return CONNECTOR_CATEGORIES.map((category) => ({
    category,
    connectors: CONNECTORS.filter((c) => c.category === category).map((def) => ({
      def,
      status: connectorStatus(def, env),
      missingEnv: def.requiredEnv.filter((name) => envValue(env, name) === undefined),
    })),
  })).filter((group) => group.connectors.length > 0);
}

export function statusCounts(report: CategoryStatusView[]): Record<ConnectorStatus, number> {
  const counts: Record<ConnectorStatus, number> = {
    connected: 0,
    add_key: 0,
    keys_set_pending_contract: 0,
    partner_access: 0,
    planned: 0,
  };
  for (const group of report) {
    for (const c of group.connectors) counts[c.status] += 1;
  }
  return counts;
}

export const STATUS_LABELS: Record<ConnectorStatus, string> = {
  connected: "Connected",
  add_key: "Ready — add key",
  keys_set_pending_contract: "Keys set — awaiting partner spec",
  partner_access: "Partner access",
  planned: "Planned",
};

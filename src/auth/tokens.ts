import { createHash, randomBytes } from "node:crypto";

import { API_KEY_PREFIX } from "./constants";

/** 32 random bytes, URL-safe. Never stored — only its digest is. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A personal API key: recognizable prefix + random secret. */
export function newApiKey(): { key: string; prefix: string; hash: string } {
  const key = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, API_KEY_PREFIX.length + 6), hash: sha256(key) };
}

export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(API_KEY_PREFIX) && value.length >= API_KEY_PREFIX.length + 20;
}

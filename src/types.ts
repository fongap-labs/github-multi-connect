/** Narrow Worker contracts for Cloudflare D1 and credential-bound runtime data. */
export type DbValue = string | number | boolean | null | Uint8Array;

export interface DbRow {
  [column: string]: DbValue;
  id: string;
  owner: string;
  owner_kind: string;
  repo: string;
  title: string;
  body: string;
  enabled: number;
  key_id: string;
  iv: string;
  ciphertext: string;
  updated_at: number;
  client_id: string;
  client_name: string;
  redirect_uris: string;
  approved: number;
  allowed_owners: string;
  allow_write: number;
  grant_types: string;
  grant_id: string | null;
  resource: string;
  scope: string;
  expires_at: number;
  auth_version: number;
  token_auth_version: number;
  client_auth_version: number;
  grant_auth_version: number;
  absolute_expires_at: number | null;
  revoked_at: number | null;
  grant_revoked_at: number | null;
  grant_scope: string | null;
  used_at: number | null;
  result_json: string | null;
  status: string;
  code_challenge: string;
  redirect_uri: string;
  state: string;
  cookie_hash: string;
  hits: number;
  created_at: number;
}
export interface D1Statement {
  bind(...values: DbValue[]): D1Statement;
  first<T extends DbRow = DbRow>(): Promise<T | null>;
  all<T extends DbRow = DbRow>(): Promise<{ results: T[] }>;
  run(): Promise<{ success?: boolean }>;
}
export interface D1Database {
  prepare(query: string): D1Statement;
}
export interface Env {
  GITHUB_DB: D1Database;
  GITHUB_MULTI_CONNECT_PUBLIC_URL: string;
  GITHUB_MULTI_CONNECT_IS_WRITE_ENABLED?: string;
  GITHUB_MULTI_CONNECT_CAN_READ_FILE_CONTENT?: string;
  GITHUB_MULTI_CONNECT_OAUTH_TOKEN_TTL_SECONDS?: string;
  ADMIN_KEY: string;
  MCP_APPROVAL_KEY: string;
  COOKIE_SIGNING_KEY: string;
  KEYRING_JSON: string;
  ACTIVE_KEY_ID: string;
  INGEST_PRIVATE_JWK: string;
}
export interface McpAuth {
  clientId: string;
  scopes: string[];
  allowedOwners: string[];
}
export interface AdminSession {
  exp: number;
  csrf: string;
}
export type DataObject = Record<string, unknown>;
export function asObject(value: unknown): DataObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid object');
  }
  return value as DataObject;
}

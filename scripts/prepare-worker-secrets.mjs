#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export const WORKER_SECRET_NAMES = Object.freeze([
  'MCP_ADMIN_KEY',
  'MCP_APPROVAL_KEY',
  'MCP_COOKIE_KEY',
  'MCP_KEYRING_JSON',
  'MCP_INGEST_JWK',
]);

export function prepareWorkerSecrets(env, destination, writer = writeFileSync) {
  if (!destination || !isAbsolute(destination)) throw new Error('Absolute secret file path required');
  const secrets = {};
  for (const name of WORKER_SECRET_NAMES) {
    const value = env[name];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Missing required source Environment Secret: ${name}`);
    }
    secrets[name] = value;
  }
  writer(destination, JSON.stringify(secrets) + '\n', { mode: 0o600, flag: 'wx' });
  return WORKER_SECRET_NAMES.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    prepareWorkerSecrets(process.env, process.argv[2]);
    console.log('Prepared a private temporary Worker Secrets file; no values logged.');
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}

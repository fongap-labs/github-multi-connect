#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const DATABASE_NAME = 'github-multi-connect';
const BUILD_RE = /^[0-9a-f]{40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE_RE = /^[A-Za-z0-9_-]{1,32}$/;
const SECRET_NAMES = ['GMC_ADMIN_KEY', 'GMC_APPROVAL_KEY', 'GMC_COOKIE_KEY', 'GMC_KEYRING_JSON', 'GMC_INGEST_JWK'];

export function loadDeployConfig(env) {
  const errors = [];
  const required = (name) => {
    const value = String(env[name] ?? '').trim();
    if (!value) errors.push(`${name} is required`);
    return value;
  };
  const account = required('CLOUDFLARE_ACCOUNT_ID_SECONDARY');
  const token = required('CLOUDFLARE_API_TOKEN_SECONDARY');
  const databaseId = required('GMC_D1_ID');
  const publicUrl = required('GMC_PUBLIC_URL');
  const activeId = required('GMC_ACTIVE_ID');
  const buildSha = required('DEPLOY_SOURCE_SHA');
  const writeMode = String(env.GMC_WRITE_MODE ?? 'disabled');
  const contentMode = String(env.GMC_CONTENT_MODE ?? 'disabled');
  const oauthTtl = String(env.GMC_OAUTH_TTL ?? '900');
  const environment = String(env.DEPLOY_ENVIRONMENT ?? 'github-multi-connect-staging');
  if (account && !/^[a-f0-9]{32}$/i.test(account)) errors.push('CLOUDFLARE_ACCOUNT_ID_SECONDARY must be a 32-character account ID');
  if (token && token.length < 8) errors.push('CLOUDFLARE_API_TOKEN_SECONDARY is invalid');
  if (databaseId && !UUID_RE.test(databaseId)) errors.push('GMC_D1_ID must be a D1 database UUID');
  if (buildSha && !BUILD_RE.test(buildSha)) errors.push('DEPLOY_SOURCE_SHA must identify an immutable full commit SHA');
  if (activeId && !ACTIVE_RE.test(activeId)) errors.push('GMC_ACTIVE_ID is invalid');
  if (!['disabled','approval'].includes(writeMode)) errors.push('GMC_WRITE_MODE must be disabled or approval');
  if (!['disabled','enabled'].includes(contentMode)) errors.push('GMC_CONTENT_MODE must be disabled or enabled');
  if (!/^\d+$/.test(oauthTtl) || Number(oauthTtl) < 300 || Number(oauthTtl) > 3600) errors.push('GMC_OAUTH_TTL must be between 300 and 3600');
  if (environment !== 'github-multi-connect-staging') errors.push('Only approved github-multi-connect-staging environment may deploy');
  try {
    const url = new URL(publicUrl);
    if (url.protocol !== 'https:' || url.pathname !== '/mcp' || url.search || url.hash || url.username || url.password || url.hostname !== 'gmc.135468.xyz')) throw Error();
  } catch {errors.push('GMC_PUBLIC_URL must be exactly https://gmc.135468.xyz/mcp');}
  if (errors.length) throw new Error(`Deployment configuration invalid: ${errors.join('; ')}`);
  return {account, token, databaseId, publicUrl, activeId, buildSha, writeMode, contentMode, oauthTtl, environment};
}

export function buildWranglerConfig(config, root=process.cwd()) {
  return {
    name: DATABASE_NAME,
    main: resolve(root, 'src/index.ts'),
    compatibility_date: '2026-11-04',
    workers_dev: false,
    preview_urls: false,
    routes: [{pattern: new URL(config.publicUrl).hostname, custom_domain: true}],
    // GitHub Variables are authoritative. Cloudflare Secrets are retained by Wrangler.
    keep_vars: false,
    vars: {
      GMC_PUBLIC_URL: config.publicUrl,
      GMC_WRITE_MODE: config.writeMode,
      GMC_CONTENT_MODE: config.contentMode,
      GMC_OAUTH_TTL: config.oauthTtl,
      GMC_ACTIVE_ID: config.activeId,
      GMC_BUILD_SHA: config.buildSha,
    },
    d1_databases: [{binding:'GITHUB_DB',database_name:DATABASE_NAME,database_id:config.databaseId,migrations_dir:resolve(root,'migrations')}],
    triggers: {crons:['0 4 * * *']},
  };
}

export async function verifyDeployment(publicUrl, expectedSha, fetcher = fetch) {
  if (!BUILD_RE.test(expectedSha)) throw new Error('Invalid expected deployment SHA');
  const url = new URL(publicUrl);
  if (url.protocol !== 'https:' || url.pathname !== '/mcp') throw new Error('Invalid health-check URL');
  const origin = url.origin;
  const request = async (path, options={}) => {
    const response = await fetcher(origin + path, {...options, signal:AbortSignal.timeout(12000)});
    return response;
  };
  const health = await request('/health');
  if (!health.ok) throw new Error(`Worker /health is not ready (HTTP ${health.status})`);
  const body = await health.json();
  if (body?.ready !== true || body?.build !== expectedSha) throw new Error('Worker health or deployment SHA does not match the approved source');
  const metadata = await request('/.well-known/oauth-authorization-server');
  if (!metadata.ok) throw new Error(`OAuth metadata request failed (HTTP ${metadata.status})`);
  const oauth = await metadata.json();
  if (oauth?.issuer !== origin) throw new Error('OAuth issuer does not match deployed Worker origin');
  const unauth = await request('/mcp', {method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  if (unauth.status !== 401) throw new Error('Unauthenticated MCP request was not denied with 401');
}

async function main() {
  const [command, filename] = process.argv.slice(2);
  if (command === 'preflight') {
    loadDeployConfig(process.env);
    console.log('GMC deployment configuration validated; no credential values printed.');
  } else if (command === 'prepare') {
    if (!filename || !filename.startsWith('/')) throw new Error('prepare requires absolute temporary file path');
    const config = buildWranglerConfig(loadDeployConfig(process.env));
    writeFileSync(filename, JSON.stringify(config,null,2)+'\n', {mode:0o600, flag:'wx'});
    console.log('Generated temporary Wrangler configuration.');
  } else if (command === 'health-check') {
    const config=loadDeployConfig(process.env);
    await verifyDeployment(config.publicUrl,config.buildSha);
    console.log('Remote Worker health, build identity, OAuth, and MCP authorization checks passed.');
  } else {
    throw new Error('Usage: deployment-config.mjs <preflight|prepare|health-check> [output-file]');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode=1; });
}
export { SECRET_NAMES };

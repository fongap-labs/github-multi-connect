import test from 'node:test';
import assert from 'node:assert/strict';
import {loadDeployConfig,buildWranglerConfig,verifyDeployment,SECRET_NAMES} from '../scripts/deployment-config.mjs';
const sha='a'.repeat(40);
function env(overrides={}){return {
  CLOUDFLARE_ACCOUNT_ID_SECONDARY:'b'.repeat(32),
  CLOUDFLARE_API_TOKEN_SECONDARY:'synthetic-credential-for-test',
  MCP_D1_ID:'12345678-1234-1234-1234-123456789abc',
  MCP_PUBLIC_URL:'https://mcp.135468.xyz',
  MCP_ACTIVE_ID:'v1',
  GMC_WRITE_MODE:'disabled',
  GMC_CONTENT_MODE:'disabled',
  MCP_OAUTH_TTL:'900',
  DEPLOY_SOURCE_SHA:sha,
  DEPLOY_ENVIRONMENT:'mcp-hub-staging', ...overrides};}
test('Generates exact approved MCP Hub bindings, no credentials or runtime secrets in config',()=>{
 const cfg=buildWranglerConfig(loadDeployConfig(env()));
 assert.equal(cfg.d1_databases[0].database_name,'mcp-hub');
 assert.ok(cfg.main.endsWith('/src/index.ts'));
 assert.ok(cfg.d1_databases[0].migrations_dir.endsWith('/migrations')); 
 assert.equal(cfg.d1_databases[0].binding,'MCP_DB');
 assert.equal(cfg.vars.MCP_BUILD_SHA,sha);
 assert.equal(cfg.vars.GMC_WRITE_MODE,'disabled');
 assert.equal(cfg.keep_vars,false);
 assert.equal(cfg.workers_dev,false);
 assert.equal(cfg.preview_urls,false);
 assert.deepEqual(cfg.routes,[{pattern:'mcp.135468.xyz',custom_domain:true}]);
 for(const s of SECRET_NAMES)assert.ok(!JSON.stringify(cfg).includes(s));
 assert.ok(!JSON.stringify(cfg).includes('synthetic-credential'));
 assert.equal(Object.keys(cfg.vars).length,6);
});
test('rejects invalid or incomplete deployment configurations',()=>{
 for(const x of [{MCP_D1_ID:''},{MCP_PUBLIC_URL:'http://mcp.135468.xyz'},{MCP_PUBLIC_URL:'https://mcp.example.workers.dev'},{MCP_PUBLIC_URL:'https://gmc.135468.xyz/mcp'},{GMC_WRITE_MODE:'true'},{GMC_CONTENT_MODE:'true'},{MCP_OAUTH_TTL:'120'},{MCP_ACTIVE_ID:''},{DEPLOY_SOURCE_SHA:'main'},{DEPLOY_ENVIRONMENT:'production'},{CLOUDFLARE_API_TOKEN_SECONDARY:''}]){
   assert.throws(()=>loadDeployConfig(env(x)));
 }
});
test('rejects cross-origin URLs and deployment paths',()=>{
 for(const u of ['https://x.test','https://x.test/oauth','https://mcp.135468.xyz/?key=1','https://u:p@x.test/mcp','https://mcp.135468.xyz/#hash'])
  assert.throws(()=>loadDeployConfig(env({MCP_PUBLIC_URL:u})));
});
test('checks build SHA, OAuth origin and unauthorized MCP access',async()=>{
 const f=async (url)=>{
  if(url.endsWith('/.well-known/oauth-protected-resource/github')) return Response.json({resource:'https://mcp.135468.xyz/github'});
  if(url.endsWith('/.well-known/oauth-protected-resource')) return Response.json({resource:'https://mcp.135468.xyz'});
  if(url.endsWith('/health')) return Response.json({status:'ok',ready:true,build:sha});
  if(url.includes('/.well-known/'))return Response.json({issuer:'https://mcp.135468.xyz'});
  if(url.endsWith('/github') || url==='https://mcp.135468.xyz/')return new Response('Unauthorized',{status:401});
  throw Error('Unexpected request');
 };
 await verifyDeployment(env().MCP_PUBLIC_URL,sha,f);
 await assert.rejects(()=>verifyDeployment(env().MCP_PUBLIC_URL,'b'.repeat(40),f),/SHA/);
});

test('committed Wrangler defaults keep workers.dev and preview URLs closed',async()=>{
 const {readFileSync}=await import('node:fs');
 const base=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
 assert.equal(base.workers_dev,false);
 assert.equal(base.preview_urls,false);
 assert.deepEqual(base.routes,[{pattern:'mcp.135468.xyz',custom_domain:true}]);
});


test('central entrypoint rejects source-owned independent deployment before Cloudflare',async()=>{
  if(process.platform==='win32')return;
  const {spawnSync}=await import('node:child_process');
  const script=new URL('../scripts/deploy.sh',import.meta.url);
  const vars={...process.env,RUNNER_TEMP:'/tmp',DEPLOY_SOURCE_SHA:sha,
    DEPLOY_SOURCE_REPOSITORY:'fongap-labs/mcp-hub',DEPLOY_ENVIRONMENT:'mcp-hub-staging',
    GITHUB_REPOSITORY:'fongap-labs/mcp-hub'};
  const r=spawnSync('bash',[script.pathname],{env:vars,encoding:'utf8'});
  assert.equal(r.status,77);
  assert.match(r.stderr,/Action Worker control plane/);
  assert.doesNotMatch(r.stdout+r.stderr,/wrangler deploy|migrations apply/);
});
test('central entrypoint rejects missing runtime Secrets before npm or Cloudflare',async()=>{
  if(process.platform==='win32')return;
  const {spawnSync}=await import('node:child_process');
  const script=new URL('../scripts/deploy.sh',import.meta.url);
  const vars={...process.env,RUNNER_TEMP:'/tmp',DEPLOY_SOURCE_SHA:sha,
    DEPLOY_SOURCE_REPOSITORY:'fongap-labs/mcp-hub',DEPLOY_ENVIRONMENT:'mcp-hub-staging',
    GITHUB_REPOSITORY:'fongap-labs/action-worker'};
  for(const name of ['CLOUDFLARE_API_TOKEN_SECONDARY','MCP_ADMIN_KEY','MCP_APPROVAL_KEY',
    'MCP_COOKIE_KEY','MCP_KEYRING_JSON','MCP_INGEST_JWK'])delete vars[name];
  const r=spawnSync('bash',[script.pathname],{env:vars,encoding:'utf8'});
  assert.equal(r.status,77);
  assert.match(r.stderr,/Required Action Worker deployment Secret is unavailable/);
  assert.doesNotMatch(r.stdout+r.stderr,/npm install|wrangler deploy|migrations apply/);
});
test('central deploy strips runtime Secrets from npm child processes',async()=>{
  const {readFileSync}=await import('node:fs');
  const script=readFileSync(new URL('../scripts/deploy.sh',import.meta.url),'utf8');
  assert.match(script,/safe_env=\\(env\\)/);
  assert.match(script,/npm install --ignore-scripts/);
  assert.match(script,/npm run validate/);
  for(const n of ['MCP_ADMIN_KEY','MCP_APPROVAL_KEY','MCP_COOKIE_KEY','MCP_KEYRING_JSON','MCP_INGEST_JWK'])
    assert.match(script,new RegExp(n));
});

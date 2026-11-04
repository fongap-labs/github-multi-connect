import test from 'node:test';
import assert from 'node:assert/strict';
import {loadDeployConfig,buildWranglerConfig,verifyDeployment,SECRET_NAMES} from '../scripts/deployment-config.mjs';
const sha='a'.repeat(40);
function env(overrides={}){return {
  CLOUDFLARE_ACCOUNT_ID_SECONDARY:'b'.repeat(32),
  CLOUDFLARE_API_TOKEN_SECONDARY:'synthetic-credential-for-test',
  GMC_D1_ID:'12345678-1234-1234-1234-123456789abc',
  GMC_PUBLIC_URL:'https://gmc.135468.xyz/mcp',
  GMC_ACTIVE_ID:'v1',
  GMC_WRITE_MODE:'disabled',
  GMC_CONTENT_MODE:'disabled',
  GMC_OAUTH_TTL:'900',
  DEPLOY_SOURCE_SHA:sha,
  DEPLOY_ENVIRONMENT:'github-multi-connect-staging', ...overrides};}
test('Generates exact approved GMC bindings, no credentials or runtime secrets in config',()=>{
 const cfg=buildWranglerConfig(loadDeployConfig(env()));
 assert.equal(cfg.d1_databases[0].database_name,'github-multi-connect');
 assert.ok(cfg.main.endsWith('/src/index.ts'));
 assert.ok(cfg.d1_databases[0].migrations_dir.endsWith('/migrations')); 
 assert.equal(cfg.d1_databases[0].binding,'GITHUB_DB');
 assert.equal(cfg.vars.GMC_BUILD_SHA,sha);
 assert.equal(cfg.vars.GMC_WRITE_MODE,'disabled');
 assert.equal(cfg.keep_vars,false);
 assert.equal(cfg.workers_dev,false);
 assert.equal(cfg.preview_urls,false);
 assert.deepEqual(cfg.routes,[{pattern:'gmc.135468.xyz',custom_domain:true}]);
 for(const s of SECRET_NAMES)assert.ok(!JSON.stringify(cfg).includes(s));
 assert.ok(!JSON.stringify(cfg).includes('synthetic-credential'));
 assert.equal(Object.keys(cfg.vars).length,6);
});
test('rejects invalid or incomplete deployment configurations',()=>{
 for(const x of [{GMC_D1_ID:''},{GMC_PUBLIC_URL:'http://gmc.135468.xyz/mcp'},{GMC_PUBLIC_URL:'https://gmc.example.workers.dev/mcp'},{GMC_WRITE_MODE:'true'},{GMC_CONTENT_MODE:'true'},{GMC_OAUTH_TTL:'120'},{GMC_ACTIVE_ID:''},{DEPLOY_SOURCE_SHA:'main'},{DEPLOY_ENVIRONMENT:'production'},{CLOUDFLARE_API_TOKEN_SECONDARY:''}]){
   assert.throws(()=>loadDeployConfig(env(x)));
 }
});
test('rejects cross-origin URLs and deployment paths',()=>{
 for(const u of ['https://x.test','https://x.test/oauth','https://x.test/mcp?key=1','https://u:p@x.test/mcp','https://x.test/mcp#hash'])
  assert.throws(()=>loadDeployConfig(env({GMC_PUBLIC_URL:u})));
});
test('checks build SHA, OAuth origin and unauthorized MCP access',async()=>{
 const f=async (url)=>{
  if(url.endsWith('/health')) return Response.json({status:'ok',ready:true,build:sha});
  if(url.includes('/.well-known/'))return Response.json({issuer:'https://gmc.135468.xyz'});
  if(url.endsWith('/mcp'))return new Response('Unauthorized',{status:401});
  throw Error('Unexpected request');
 };
 await verifyDeployment(env().GMC_PUBLIC_URL,sha,f);
 await assert.rejects(()=>verifyDeployment(env().GMC_PUBLIC_URL,'b'.repeat(40),f),/SHA/);
});

test('committed Wrangler defaults keep workers.dev and preview URLs closed',async()=>{
 const {readFileSync}=await import('node:fs');
 const base=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
 assert.equal(base.workers_dev,false);
 assert.equal(base.preview_urls,false);
 assert.deepEqual(base.routes,[{pattern:'gmc.135468.xyz',custom_domain:true}]);
});

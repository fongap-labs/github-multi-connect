import type { Env } from './types.ts';
import {json} from './util.ts';
import {BRAND_ICON} from './brand.ts';
import {protectedMetadata,serverMetadata,registerClient,authorizeGet,authorizePost,tokenEndpoint,revokeToken,validateMcpToken,challenge,cleanExpired} from './oauth.ts';
import {adminRoute} from './admin.ts';
import {serverForPath,serverForMetadata} from './gateway/registry.ts';
import {processMcp} from './gateway/router.ts';

export default {
  async fetch(request: Request,env: Env): Promise<Response> {
    try {
      const url=new URL(request.url), path=url.pathname;
      if(path==='/brand/icon.svg'&&request.method==='GET')return new Response(BRAND_ICON,{headers:{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});
      if(path==='/health'&&request.method==='GET'){
        const ready=Boolean(env.MCP_DB && env.MCP_PUBLIC_URL && env.MCP_ADMIN_KEY && env.MCP_APPROVAL_KEY && env.MCP_COOKIE_KEY && env.MCP_KEYRING_JSON && env.MCP_ACTIVE_ID && env.MCP_INGEST_JWK);
        return json({status:ready?'ok':'unavailable',ready,build:env.MCP_BUILD_SHA||null},ready?200:503);
      }
      const metadataServer=serverForMetadata(path);
      if(metadataServer)return protectedMetadata(env,metadataServer);
      if(path==='/.well-known/oauth-authorization-server')return serverMetadata(env);
      if(path==='/oauth/register'&&request.method==='POST')return registerClient(request,env);
      if(path==='/oauth/token'&&request.method==='POST')return tokenEndpoint(request,env);
      if(path==='/oauth/revoke'&&request.method==='POST')return revokeToken(request,env);
      if(path==='/authorize')return request.method==='GET'?authorizeGet(request,env):request.method==='POST'?authorizePost(request,env):json({error:'Method not allowed'},405);
      if(path.startsWith('/admin'))return adminRoute(request,env);
      const mcpServer=serverForPath(path);
      if(mcpServer){
        const auth=await validateMcpToken(request,env,mcpServer);
        if(!auth)return challenge(env,mcpServer);
        return processMcp(request,env,auth,mcpServer);
      }
      return json({error:'Not found'},404);
    } catch {
      // Do not log or return thrown errors. Raw exceptions can contain sensitive data.
      return json({error:'Internal error'},500);
    }
  },
  async scheduled(_event: unknown,env: Env): Promise<void> {try{await cleanExpired(env);}catch{/* No credentials or raw errors in logs. */}}
};

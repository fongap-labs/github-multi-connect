import {json} from './util.js';
import {BRAND_ICON} from './brand.js';
import {protectedMetadata,serverMetadata,registerClient,authorizeGet,authorizePost,tokenEndpoint,revokeToken,validateMcpToken,challenge,cleanExpired} from './oauth.js';
import {adminRoute} from './admin.js';
import {processMcp} from './mcp.js';

export default {
  async fetch(request,env) {
    try {
      const url=new URL(request.url), path=url.pathname;
      if(path==='/brand/icon.svg'&&request.method==='GET')return new Response(BRAND_ICON,{headers:{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});
      if(path==='/health'&&request.method==='GET')return json({status:'ok'});
      if(path==='/')return new Response(null,{status:302,headers:{Location:'/admin','Cache-Control':'no-store'}});
      if(path==='/.well-known/oauth-protected-resource' || path==='/.well-known/oauth-protected-resource/mcp')return protectedMetadata(env);
      if(path==='/.well-known/oauth-authorization-server')return serverMetadata(env);
      if(path==='/oauth/register'&&request.method==='POST')return registerClient(request,env);
      if(path==='/oauth/token'&&request.method==='POST')return tokenEndpoint(request,env);
      if(path==='/oauth/revoke'&&request.method==='POST')return revokeToken(request,env);
      if(path==='/authorize')return request.method==='GET'?authorizeGet(request,env):request.method==='POST'?authorizePost(request,env):json({error:'Method not allowed'},405);
      if(path.startsWith('/admin'))return adminRoute(request,env);
      if(path==='/mcp') {
        const auth=await validateMcpToken(request,env);
        if(!auth)return challenge(env);
        return processMcp(request,env,auth);
      }
      return json({error:'Not found'},404);
    } catch {
      // Do not log or return thrown errors. Raw exceptions can contain sensitive data.
      return json({error:'Internal error'},500);
    }
  },
  async scheduled(_event,env) {try{await cleanExpired(env);}catch{/* No credentials or raw errors in logs. */}}
};

import {now,b64u,unb64u,encoder,randomId,equals,cookie,originOk,form,bodyJson,json,html,escapeHtml,validOwner} from './util.js';
import {ingestionPublicJwk,decryptIngested,seal,unseal} from './crypto.js';
import {apiFetch,githubPath,getOwnerToken,PublicError} from './github.js';
import {ADMIN_SCRIPT,ADMIN_CSS} from './admin-ui.js';
import {BRAND_NAME,BRAND_HEAD,BRAND_HEADER} from './brand.js';
import {rateLimit} from './oauth.js';
import {revokeClientTokens} from './tokens.js';

const COOKIE='__Host-gmcp-admin';
const loginPage=`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${BRAND_HEAD}<title>${BRAND_NAME} · 管理登录</title><link rel="stylesheet" href="/admin/app.css"><main>${BRAND_HEADER}<h2>管理登录</h2><p>此页面只面向管理员。请勿将管理密钥提供给 Agent。</p><form method="post" action="/admin/login"><label>管理密钥<input type="password" name="key" autocomplete="off" required></label><button>登录</button></form></main></html>`;
const locked=()=>html(loginPage);
function sessionKey(env) { if(!env.COOKIE_SIGNING_KEY||env.COOKIE_SIGNING_KEY.length<32) throw new Error('COOKIE_SIGNING_KEY too short');return encoder.encode(env.COOKIE_SIGNING_KEY); }
async function sign(env,body) {const key=await crypto.subtle.importKey('raw',sessionKey(env),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64u(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(body))));}
export async function getSession(request,env) {
  try {
    const [body,signature,extra]=(cookie(request,COOKIE)||'').split('.');if(!body||!signature||extra)return null;
    const decoded=JSON.parse(new TextDecoder().decode(unb64u(body)));
    if(!decoded.exp||decoded.exp<=now()||typeof decoded.csrf!=='string'||decoded.csrf.length!==43)return null;
    if(!(await equals(await sign(env,body),signature)))return null;
    return decoded;
  }catch{return null;}
}
function redirect(path,headers={}){return new Response(null,{status:303,headers:{'Location':path,'Cache-Control':'no-store',...headers}});}
export async function adminLogin(request,env) {
  if(!originOk(request))return json({error:'Forbidden'},403);
  if(!(await rateLimit(env,request,'admin-login',15)))return json({error:'Rate limited'},429);
  const p=await form(request);const proposed=p.get('key')||'';
  if(!env.ADMIN_KEY||env.ADMIN_KEY.length<32||!(await equals(proposed,env.ADMIN_KEY)))return html('<p>Invalid credentials.</p>',403);
  const data={exp:now()+1800,csrf:randomId()};const body=b64u(encoder.encode(JSON.stringify(data)));const value=body+'.'+await sign(env,body);
  return redirect('/admin',{'Set-Cookie':`${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800`});
}
export async function adminPage(request,env) {
  const session=await getSession(request,env);if(!session)return locked();
  const {results=[]}=await env.GITHUB_DB.prepare('SELECT owner,owner_kind,enabled,updated_at FROM github_connections ORDER BY owner').all();
  const clients=(await env.GITHUB_DB.prepare('SELECT client_id,client_name,redirect_uris,approved,allowed_owners,allow_write FROM oauth_clients ORDER BY created_at DESC LIMIT 100').all()).results||[];
  const clientRows=clients.map(c=>`<tr><td>${escapeHtml(c.client_name)}<div class="muted"><code>${escapeHtml(c.client_id)}</code></div></td><td>${escapeHtml(JSON.parse(c.redirect_uris).join(', '))}</td><td>${c.approved?'已批准':'待批准'}</td><td>${escapeHtml(JSON.parse(c.allowed_owners).join(', '))}</td><td><button type="button" class="approve-client" data-client="${escapeHtml(c.client_id)}">设置权限</button> <button type="button" class="revoke-client danger" data-client="${escapeHtml(c.client_id)}">撤销</button></td></tr>`).join('');
  const pending=(await env.GITHUB_DB.prepare("SELECT id,client_id,owner,repo,title,body,expires_at FROM approval_requests WHERE status='pending' AND expires_at>? ORDER BY created_at ASC LIMIT 50").bind(now()).all()).results||[];
  const pendingRows=pending.map(r=>`<tr><td>${escapeHtml(r.owner+'/'+r.repo)}</td><td><strong>${escapeHtml(r.title)}</strong><div class="muted">${escapeHtml(r.body.slice(0,300))}</div></td><td>${escapeHtml(new Date(r.expires_at*1000).toISOString().slice(11,19))} UTC</td><td><button type="button" class="approve-operation" data-operation="${escapeHtml(r.id)}">审批执行</button> <button type="button" class="deny-operation danger" data-operation="${escapeHtml(r.id)}">拒绝</button></td></tr>`).join('');
  const rows=results.map(r=>`<tr><td>${escapeHtml(r.owner)}</td><td>${escapeHtml(r.owner_kind)}</td><td>${r.enabled?'启用':'停用'}</td><td>${new Date(r.updated_at*1000).toISOString().slice(0,10)}</td><td><button type="button" class="toggle" data-owner="${escapeHtml(r.owner)}" data-enabled="${r.enabled?'0':'1'}">${r.enabled?'停用':'启用'}</button> <button type="button" class="delete danger" data-owner="${escapeHtml(r.owner)}">删除</button></td></tr>`).join('');
  const document=`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="csrf-token" content="${session.csrf}">${BRAND_HEAD}<title>${BRAND_NAME} · 连接管理</title><link rel="stylesheet" href="/admin/app.css"><main><header>${BRAND_HEADER}<form id="logout" method="post" action="/admin/logout"><input type="hidden" name="csrf" value="${session.csrf}"><button class="secondary">退出登录</button></form></header><p>GitHub Token 只在浏览器中进行 RSA-OAEP + AES-GCM 加密，提交时发送密文；数据库只保存另行加密的密文。Token 不可查看、不可导出。</p><h2>GitHub 账号连接</h2><table><thead><tr><th>Owner</th><th>类型</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>${rows||'<tr><td colspan="5">尚无连接</td></tr>'}</tbody></table><h2>添加 / 更换 GitHub 连接</h2><p>Owner 填仓库地址中的用户名或组织名。相同 Owner 再次提交会替换凭据。建议只使用最小权限 fine-grained PAT。</p><form id="add"><label>GitHub Owner<input name="owner" type="text" maxlength="39" placeholder="example-org" autocomplete="off" required></label><label>账号类型<select name="kind"><option value="Organization">组织</option><option value="User">个人</option></select></label><label>GitHub Token<input name="token" type="password" autocomplete="off" spellcheck="false" required></label><button>加密并保存</button></form><p id="result" role="status" aria-live="polite"></p><h2>授权 MCP 客户端</h2><p>客户端自动注册后默认没有权限。管理员需明确批准并指定可用的 GitHub Owner。撤销或修改权限会立即吊销该客户端全部 Access Token 和 Refresh Token。</p><table><thead><tr><th>客户端</th><th>回调 URI</th><th>状态</th><th>获授权 Owner</th><th>操作</th></tr></thead><tbody>${clientRows||'<tr><td colspan="5">尚无 MCP 客户端注册</td></tr>'}</tbody></table><p class="muted">点击“设置权限”时，输入允许访问的 Owner（英文逗号分隔）；需先添加 GitHub 连接。</p><h2>写操作人工审批</h2><p>所有 GitHub 写操作必须在此处由管理员人工审批才执行。过期的请求不会被执行。</p><table><thead><tr><th>仓库</th><th>操作内容</th><th>到期</th><th>审批</th></tr></thead><tbody>${pendingRows||'<tr><td colspan="4">暂无待审批写操作</td></tr>'}</tbody></table><h2>加密密钥轮换</h2><p>请先在 Cloudflare Secret 中配置新版本 KEYRING_JSON、ACTIVE_KEY_ID；确认两个密钥版本均可读取后再点击下方按钮，每次处理最多 50 条。</p><button type="button" id="rekey" class="secondary">迁移旧密钥加密的数据</button><p class="muted">管理页面 30 分钟后需要重新登录。不要把管理密钥或 GitHub Token 放进 MCP 工具参数、AI 对话或日志。</p></main><script src="/admin/app.js" defer></script></html>`;
  return html(document);
}
async function guard(request,env) {
  const session=await getSession(request,env);if(!session||!originOk(request))return null;
  const csrf=request.headers.get('X-CSRF-Token')||'';
  return await equals(csrf,session.csrf)?session:null;
}
export async function adminApi(request,env,path) {
  if(!(await getSession(request,env)))return json({error:'Unauthorized'},401);
  if(path==='/admin/api/public-key'&&request.method==='GET')return json(ingestionPublicJwk(env));
  if(request.method!=='POST'||!await guard(request,env))return json({error:'Forbidden'},403);
  if(path==='/admin/api/connections'){
    let data;try{data=await bodyJson(request,13000);}catch{return json({error:'Invalid request'},400);}
    if(!validOwner(data.owner)||!['User','Organization'].includes(data.kind))return json({error:'Invalid owner or kind'},400);
    const owner=data.owner.toLowerCase();
    let token;
    try {token=await decryptIngested(env,data.encrypted);}catch{return json({error:'Unable to decrypt token'},400);}
    try {
      const [user, identity]=await Promise.all([
        apiFetch(token,'/user'),apiFetch(token,githubPath({owner,kind:'owner_identity'}))
      ]);
      if(!user?.login||identity?.type!==data.kind) return json({error:'Owner kind mismatch or invalid credential'},400);
    } catch(e) {return json({error:e instanceof PublicError?e.message:'Token validation failed'},400);}
    const sealed=await seal(env,owner,token);token=undefined;
    const ts=now();
    await env.GITHUB_DB.prepare(`INSERT INTO github_connections(owner,owner_kind,key_id,iv,ciphertext,enabled,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?) ON CONFLICT(owner) DO UPDATE SET owner_kind=excluded.owner_kind,key_id=excluded.key_id,iv=excluded.iv,ciphertext=excluded.ciphertext,enabled=1,updated_at=excluded.updated_at`).bind(owner,data.kind,sealed.key_id,sealed.iv,sealed.ciphertext,ts,ts).run();
    return json({ok:true,owner});
  }
  if(path==='/admin/api/status'||path==='/admin/api/delete'){
    let body;try{body=await bodyJson(request,1024);}catch{return json({error:'Invalid request'},400);}
    if(!validOwner(body.owner))return json({error:'Invalid owner'},400);
    if(path.endsWith('/delete')) await env.GITHUB_DB.prepare('DELETE FROM github_connections WHERE owner=?').bind(body.owner.toLowerCase()).run();
    else {
      if(typeof body.enabled!=='boolean')return json({error:'Invalid status'},400);
      await env.GITHUB_DB.prepare('UPDATE github_connections SET enabled=?,updated_at=? WHERE owner=?').bind(body.enabled?1:0,now(),body.owner.toLowerCase()).run();
    }
    return json({ok:true});
  }
  if(path==='/admin/api/client-approval'){
    let data;try{data=await bodyJson(request,4096);}catch{return json({error:'Invalid request'},400);}
    if(typeof data.clientId!=='string'||data.clientId.length>100)return json({error:'Invalid client'},400);
    if(data.approved===false){
      await revokeClientTokens(env,data.clientId);
      await env.GITHUB_DB.prepare('UPDATE oauth_clients SET approved=0,allowed_owners=?,allow_write=0,auth_version=auth_version+1 WHERE client_id=?').bind('[]',data.clientId).run();
      return json({ok:true});
    }
    const allowed=data.allowedOwners;
    if(!Array.isArray(allowed)||allowed.length<1||allowed.length>30||allowed.some(x=>!validOwner(x)))return json({error:'At least one valid owner is required'},400);
    const distinct=[...new Set(allowed.map(x=>x.toLowerCase()))];
    for(const owner of distinct){const exists=await env.GITHUB_DB.prepare('SELECT enabled FROM github_connections WHERE owner=?').bind(owner).first();if(!exists?.enabled)return json({error:'Owner missing or disabled: '+owner},400);}
    // Any permission update invalidates the previous authorization grant family,
    // even if the client is later re-approved.
    await revokeClientTokens(env,data.clientId);
    const row=await env.GITHUB_DB.prepare('UPDATE oauth_clients SET approved=1,allowed_owners=?,allow_write=?,auth_version=auth_version+1 WHERE client_id=? RETURNING client_id').bind(JSON.stringify(distinct),data.allowWrite===true?1:0,data.clientId).first();
    if(!row)return json({error:'Client not found'},404);
    return json({ok:true});
  }
  if(path==='/admin/api/operation'){
    let data;try{data=await bodyJson(request,2048);}catch{return json({error:'Invalid request'},400);}
    if(typeof data.id!=='string'||!/^[a-zA-Z0-9_-]{43}$/.test(data.id)||!['approve','deny'].includes(data.action))return json({error:'Invalid operation'},400);
    if(data.action==='deny'){
      const row=await env.GITHUB_DB.prepare("UPDATE approval_requests SET status='denied' WHERE id=? AND status='pending' RETURNING id").bind(data.id).first();
      return row?json({ok:true,status:'denied'}):json({error:'Request already handled'},409);
    }
    if(env.GITHUB_WRITE_ENABLED!=='true')return json({error:'Write operations disabled in Worker configuration'},403);
    const req=await env.GITHUB_DB.prepare("SELECT r.* FROM approval_requests r JOIN oauth_clients c ON r.client_id=c.client_id WHERE r.id=? AND r.status='pending' AND r.expires_at>? AND c.approved=1 AND c.allow_write=1").bind(data.id,now()).first();
    if(!req)return json({error:'Request not eligible for approval'},409);
    const client=await env.GITHUB_DB.prepare('SELECT allowed_owners FROM oauth_clients WHERE client_id=?').bind(req.client_id).first();
    if(!client||!JSON.parse(client.allowed_owners).includes(req.owner))return json({error:'Client lost owner permission'},403);
    const claimed=await env.GITHUB_DB.prepare("UPDATE approval_requests SET status='processing' WHERE id=? AND status='pending' AND expires_at>? RETURNING id").bind(data.id,now()).first();
    if(!claimed)return json({error:'Request already handled'},409);
    try {
      const token=await getOwnerToken(env,req.owner);
      const path=githubPath({owner:req.owner,repo:req.repo,kind:'repo'});
      const response=await apiFetch(token,path+'/issues',{method:'POST',body:{title:req.title,body:req.body}});
      const result={number:response.number,title:response.title,url:response.html_url};
      await env.GITHUB_DB.prepare("UPDATE approval_requests SET status='approved',result_json=? WHERE id=? AND status='processing'").bind(JSON.stringify(result),req.id).run();
      return json({ok:true,status:'approved',result});
    } catch {
      // Do not automatically retry a non-idempotent GitHub write operation.
      await env.GITHUB_DB.prepare("UPDATE approval_requests SET status='failed' WHERE id=? AND status='processing'").bind(req.id).run();
      return json({error:'Approval action failed. Check GitHub before retrying.'},502);
    }
  }
  if(path==='/admin/api/rekey'){
    const {results=[]}=await env.GITHUB_DB.prepare('SELECT * FROM github_connections WHERE key_id<>? LIMIT 50').bind(env.ACTIVE_KEY_ID).all();
    for(const row of results) {
      const token=await unseal(env,row);const sealed=await seal(env,row.owner,token);
      await env.GITHUB_DB.prepare('UPDATE github_connections SET key_id=?,iv=?,ciphertext=?,updated_at=? WHERE owner=? AND key_id=?').bind(sealed.key_id,sealed.iv,sealed.ciphertext,now(),row.owner,row.key_id).run();
    }
    const remaining=await env.GITHUB_DB.prepare('SELECT COUNT(*) AS cnt FROM github_connections WHERE key_id<>?').bind(env.ACTIVE_KEY_ID).first();
    return json({ok:true,processed:results.length,remaining:remaining.cnt});
  }
  return json({error:'Not found'},404);
}
export async function adminRoute(request,env) {
  const path=new URL(request.url).pathname;
  if(path==='/admin/app.js'&&request.method==='GET')return new Response(ADMIN_SCRIPT,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  if(path==='/admin/app.css'&&request.method==='GET')return new Response(ADMIN_CSS,{headers:{'Content-Type':'text/css; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  if(path==='/admin/login'&&request.method==='POST')return adminLogin(request,env);
  if(path==='/admin/logout'&&request.method==='POST'){
    if(!originOk(request))return json({error:'Forbidden'},403);
    const p=await form(request);const s=await getSession(request,env);
    if(!s||!(await equals(p.get('csrf')||'',s.csrf)))return json({error:'Forbidden'},403);
    return redirect('/admin',{'Set-Cookie':`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`});
  }
  if(path==='/admin'&&request.method==='GET')return adminPage(request,env);
  if(path.startsWith('/admin/api/'))return adminApi(request,env,path);
  return json({error:'Not found'},404);
}

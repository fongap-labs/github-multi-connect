import {randomId,sha,now,json} from './util.js';

export const ACCESS_TOKEN_TTL_DEFAULT=900;
export const REFRESH_TOKEN_IDLE_SECONDS=30*86400;
export const GRANT_ABSOLUTE_SECONDS=90*86400;
const refreshTokenRe=/^mcrt_[A-Za-z0-9_-]{43}$/;
const accessTokenRe=/^[A-Za-z0-9_-]{43}$/;

function ttl(env) {
  const configured=Number(env.GITHUB_MULTI_CONNECT_OAUTH_TOKEN_TTL_SECONDS);
  return Number.isFinite(configured) && configured >=300 && configured<=3600 ? Math.trunc(configured) : ACCESS_TOKEN_TTL_DEFAULT;
}
function bearerResponse(accessToken,ttlSeconds,scope,refreshToken,refreshExpiresAt){
  return json({
    access_token:accessToken, token_type:'Bearer',expires_in:ttlSeconds,scope,
    ...(refreshToken?{refresh_token:refreshToken,refresh_token_expires_in:Math.max(0,refreshExpiresAt-now())}:{})
  },200,{'Pragma':'no-cache'});
}
const oauthError=(error,status=400)=>json({error},status,{'Pragma':'no-cache'});
function restrictedScope(scope,client,requested){
  const scopes=scope.split(' ').filter(Boolean);
  if(!client.approved || !scopes.includes('mcp:read'))return null;
  if(!client.allow_write) {
    const idx=scopes.indexOf('mcp:write'); if(idx!==-1)scopes.splice(idx,1);
  }
  if(requested!==null){
    const wanted=requested.trim().split(/\s+/).filter(Boolean);
    if(wanted.length===0 || !wanted.includes('mcp:read') || wanted.some(s=>!scopes.includes(s))) return null;
    return [...new Set(wanted)].join(' ');
  }
  return scopes.join(' ');
}

// A grant exists only for public OAuth clients that explicitly registered
// support for refresh_token. No long-lived secret is ever returned via MCP tools.
export async function issueAuthorizationTokens(env,authCode,client){
  const issuedAt=now(), lifetime=ttl(env);
  const scope=restrictedScope(authCode.scope,client,null);
  if(!scope)return oauthError('invalid_grant');
  const accessToken=randomId();
  const refreshEnabled=JSON.parse(client.grant_types).includes('refresh_token');
  let grantId=null,refreshToken=null,refreshExpiresAt=null;
  if(refreshEnabled){
    grantId=randomId(); refreshToken='mcrt_'+randomId();
    const absolute=issuedAt+GRANT_ABSOLUTE_SECONDS;
    refreshExpiresAt=Math.min(issuedAt+REFRESH_TOKEN_IDLE_SECONDS,absolute);
    await env.GITHUB_DB.prepare('INSERT INTO oauth_grants(grant_id,client_id,resource,scope,auth_version,created_at,absolute_expires_at) VALUES(?,?,?,?,?,?,?)')
      .bind(grantId,authCode.client_id,authCode.resource,scope,client.auth_version,issuedAt,absolute).run();
    await env.GITHUB_DB.prepare('INSERT INTO oauth_refresh_tokens(token_hash,grant_id,client_id,issued_at,expires_at) VALUES(?,?,?,?,?)')
      .bind(await sha(refreshToken),grantId,authCode.client_id,issuedAt,refreshExpiresAt).run();
  }
  await env.GITHUB_DB.prepare('INSERT INTO oauth_access_tokens(token_hash,client_id,resource,scope,expires_at,grant_id,auth_version) VALUES(?,?,?,?,?,?,?)')
    .bind(await sha(accessToken),authCode.client_id,authCode.resource,scope,issuedAt+lifetime,grantId,client.auth_version).run();
  return bearerResponse(accessToken,lifetime,scope,refreshToken,refreshExpiresAt);
}

// Rotation is a single-winner compare-and-swap. A reused, already-consumed
// token revokes its entire family, including previously minted access tokens.
// Clients MUST serialize refresh requests; ambiguous concurrent use fails closed.
export async function rotateRefreshToken(env,p){
  const refreshToken=p.get('refresh_token')||'';
  const clientId=p.get('client_id')||'';
  if(!refreshTokenRe.test(refreshToken)||!/^mcp_[A-Za-z0-9_-]{43}$/.test(clientId))return oauthError('invalid_grant');
  const tokenHash=await sha(refreshToken), current=now();
  const row=await env.GITHUB_DB.prepare(`SELECT t.grant_id,t.client_id,t.used_at,t.expires_at,
    g.resource,g.scope,g.absolute_expires_at,g.revoked_at,g.auth_version AS grant_auth_version,
    c.approved,c.allow_write,c.grant_types,c.auth_version AS client_auth_version
    FROM oauth_refresh_tokens t JOIN oauth_grants g ON g.grant_id=t.grant_id
    JOIN oauth_clients c ON c.client_id=g.client_id WHERE t.token_hash=?`)
    .bind(tokenHash).first();
  if(!row||row.client_id!==clientId||!JSON.parse(row.grant_types).includes('refresh_token'))return oauthError('invalid_grant');
  // The client cannot change audience or request expanded privileges.
  if(p.has('resource')&&p.get('resource')!==row.resource)return oauthError('invalid_target');
  if(row.revoked_at!==null||!row.approved||row.grant_auth_version!==row.client_auth_version||row.absolute_expires_at<=current)return oauthError('invalid_grant');
  if(row.used_at!==null){
    await revokeGrant(env,row.grant_id,current);
    return oauthError('invalid_grant');
  }
  if(row.expires_at<=current)return oauthError('invalid_grant');
  const scope=restrictedScope(row.scope,row,p.has('scope')?p.get('scope'):null);
  if(!scope)return oauthError('invalid_scope');
  // Conditional mutation ensures concurrent Workers cannot successfully use
  // the same refresh credential. The loser treats it as suspected replay.
  const claimed=await env.GITHUB_DB.prepare(`UPDATE oauth_refresh_tokens SET used_at=?
    WHERE token_hash=? AND client_id=? AND used_at IS NULL AND expires_at>?
    AND EXISTS (SELECT 1 FROM oauth_grants WHERE grant_id=oauth_refresh_tokens.grant_id
                AND revoked_at IS NULL AND absolute_expires_at>?)
    RETURNING grant_id`)
    .bind(current,tokenHash,clientId,current,current).first();
  if(!claimed){
    await revokeGrant(env,row.grant_id,current);
    return oauthError('invalid_grant');
  }
  const newAccess=randomId(), newRefresh='mcrt_'+randomId();
  const nextRefreshExpiresAt=Math.min(current+REFRESH_TOKEN_IDLE_SECONDS,row.absolute_expires_at);
  const lifetime=ttl(env);
  // Narrowed scopes stay narrowed for the entire family.
  const updated=await env.GITHUB_DB.prepare('UPDATE oauth_grants SET scope=? WHERE grant_id=? AND revoked_at IS NULL AND absolute_expires_at>? RETURNING grant_id')
    .bind(scope,row.grant_id,current).first();
  if(!updated)return oauthError('invalid_grant');
  await env.GITHUB_DB.prepare(`INSERT INTO oauth_refresh_tokens(token_hash,grant_id,client_id,issued_at,expires_at)
    SELECT ?,grant_id,client_id,?,? FROM oauth_grants WHERE grant_id=? AND revoked_at IS NULL AND absolute_expires_at>?`)
    .bind(await sha(newRefresh),current,nextRefreshExpiresAt,row.grant_id,current).run();
  await env.GITHUB_DB.prepare(`INSERT INTO oauth_access_tokens(token_hash,client_id,resource,scope,expires_at,grant_id,auth_version)
    SELECT ?,client_id,resource,scope,?,grant_id,auth_version FROM oauth_grants WHERE grant_id=? AND revoked_at IS NULL AND absolute_expires_at>?`)
    .bind(await sha(newAccess),current+lifetime,row.grant_id,current).run();
  // Final check closes the window where a parallel replay revokes the family.
  const active=await env.GITHUB_DB.prepare('SELECT grant_id FROM oauth_grants WHERE grant_id=? AND revoked_at IS NULL AND absolute_expires_at>?')
    .bind(row.grant_id,now()).first();
  if(!active)return oauthError('invalid_grant');
  return bearerResponse(newAccess,lifetime,scope,newRefresh,nextRefreshExpiresAt);
}

export async function revokeGrant(env,grantId,ts=now()){
  await env.GITHUB_DB.prepare('UPDATE oauth_grants SET revoked_at=? WHERE grant_id=? AND revoked_at IS NULL')
    .bind(ts,grantId).run();
  // The API checks grant.revoked_at so these deletes are defense in depth.
  await env.GITHUB_DB.prepare('DELETE FROM oauth_access_tokens WHERE grant_id=?').bind(grantId).run();
}
export async function revokeOAuthToken(env,token,clientId){
  if(typeof clientId!=='string'||!/^mcp_[A-Za-z0-9_-]{43}$/.test(clientId))return;
  if(refreshTokenRe.test(token)){
    const row=await env.GITHUB_DB.prepare('SELECT grant_id FROM oauth_refresh_tokens WHERE token_hash=? AND client_id=?')
      .bind(await sha(token),clientId).first();
    if(row)await revokeGrant(env,row.grant_id);
  }else if(accessTokenRe.test(token)){
    await env.GITHUB_DB.prepare('DELETE FROM oauth_access_tokens WHERE token_hash=? AND client_id=?')
      .bind(await sha(token),clientId).run();
  }
}
export async function revokeClientTokens(env,clientId){
  await env.GITHUB_DB.prepare('UPDATE oauth_grants SET revoked_at=? WHERE client_id=? AND revoked_at IS NULL')
    .bind(now(),clientId).run();
  await env.GITHUB_DB.prepare('DELETE FROM oauth_access_tokens WHERE client_id=?').bind(clientId).run();
  await env.GITHUB_DB.prepare('DELETE FROM oauth_codes WHERE client_id=?').bind(clientId).run();
  await env.GITHUB_DB.prepare('DELETE FROM oauth_auth_requests WHERE client_id=?').bind(clientId).run();
}
export async function cleanOAuthGrants(env){
  const cutoff=now()-7*86400;
  // Keep consumed refresh hashes until family closure for replay detection.
  await env.GITHUB_DB.prepare(`DELETE FROM oauth_refresh_tokens WHERE grant_id IN
    (SELECT grant_id FROM oauth_grants WHERE absolute_expires_at<? OR (revoked_at IS NOT NULL AND revoked_at<?))`)
    .bind(cutoff,cutoff).run();
  await env.GITHUB_DB.prepare('DELETE FROM oauth_grants WHERE absolute_expires_at<? OR (revoked_at IS NOT NULL AND revoked_at<?)')
    .bind(cutoff,cutoff).run();
}

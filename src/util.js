export const now = () => Math.floor(Date.now() / 1000);
export const encoder = new TextEncoder();
export const decoder = new TextDecoder();

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', ...extra }
  });
}
export function html(body, status = 200, extra = {}) {
  return new Response(body, {status, headers: {
    'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
    'X-Frame-Options':'DENY',
    'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    ...extra
  }});
}
export function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function b64(bytes) { return btoa(String.fromCharCode(...bytes)); }
export function unb64(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length > 16384 || s.length % 4 === 1) throw new Error('Invalid encoding');
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
export function b64u(bytes) { return b64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
export function unb64u(s) { if(!/^[\w-]+$/.test(s) || s.length > 16384) throw new Error('Invalid encoding'); return unb64(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)); }
export function randomId() { return b64u(crypto.getRandomValues(new Uint8Array(32))); }
export async function sha(s) { return b64u(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(s)))); }
export async function equals(a,b) {
  const [da,db] = await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(String(a))),crypto.subtle.digest('SHA-256',encoder.encode(String(b)))]);
  const x=new Uint8Array(da), y=new Uint8Array(db); let diff=0;
  for (let i=0;i<x.length;i++) diff|=x[i]^y[i]; return diff===0;
}
export function cookie(request, name) {
  const raw=request.headers.get('Cookie')||'';
  for (const item of raw.split(';')) { const [k,...v]=item.trim().split('='); if(k===name) return v.join('='); }
  return '';
}
export function originOk(request) { const origin=request.headers.get('Origin'); return !!origin && origin===new URL(request.url).origin; }
export async function bodyJson(request, max=16384) {
  const len=Number(request.headers.get('Content-Length')||0);
  if (len>max) throw new Error('Body too large');
  const raw=await request.text(); if(encoder.encode(raw).byteLength>max) throw new Error('Body too large');
  const data=JSON.parse(raw); if(!data || Array.isArray(data) || typeof data!=='object') throw new Error('Invalid JSON'); return data;
}
export async function form(request,max=8192) {
  const raw=await request.text(); if(encoder.encode(raw).byteLength>max) throw new Error('Body too large');
  return new URLSearchParams(raw);
}
export const ownerPattern = /^(?!-)[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
export const repoPattern = /^[\w.-]{1,100}$/;
export function validOwner(s) {return typeof s==='string'&&ownerPattern.test(s)&&s.length<=39;}
export function validRepo(s) {return typeof s==='string'&&repoPattern.test(s)&&s!=='.'&&s!=='..';}
export function deny(status=403) { return json({error: status===401?'Unauthorized':'Forbidden'},status); }

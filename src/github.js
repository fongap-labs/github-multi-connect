import {validOwner,validRepo} from './util.js';
import {unseal} from './crypto.js';

export class PublicError extends Error { constructor(message) {super(message);this.name='PublicError';} }
export function githubPath({owner,repo,kind,number,path,ref,state,per_page}) {
  if(!validOwner(owner)) throw new PublicError('Invalid GitHub owner');
  const root='/repos/'+encodeURIComponent(owner);
  if(kind==='owner_identity') return '/users/'+encodeURIComponent(owner);
  if(!validRepo(repo)) throw new PublicError('Invalid repository name');
  const base=root+'/'+encodeURIComponent(repo);
  if(kind==='repo') return base;
  if(kind==='issues') return base+'/issues?'+new URLSearchParams({state:['open','closed','all'].includes(state)?state:'open',per_page:String(Math.min(50,Math.max(1,Number(per_page)||20)))});
  if(kind==='issue') {if(!Number.isSafeInteger(number)||number<1) throw new PublicError('Invalid issue number'); return base+'/issues/'+number;}
  if(kind==='pulls') return base+'/pulls?'+new URLSearchParams({state:['open','closed','all'].includes(state)?state:'open',per_page:String(Math.min(50,Math.max(1,Number(per_page)||20)))});
  if(kind==='pull') {if(!Number.isSafeInteger(number)||number<1) throw new PublicError('Invalid pull request number'); return base+'/pulls/'+number;}
  if(kind==='file') {
    if(typeof path!=='string'||path.length>1000||path.startsWith('/')||path.split('/').some(x=>!x||x==='.'||x==='..'||/[\\\0-\x1f]/.test(x))) throw new PublicError('Invalid file path');
    const target=base+'/contents/'+path.split('/').map(encodeURIComponent).join('/');
    return ref ? target+'?'+new URLSearchParams({ref:String(ref).slice(0,100)}) : target;
  }
  throw new PublicError('Unsupported operation');
}

export async function apiFetch(token,path,options={}) {
  // GitHub is the ONLY outbound target, with fixed API origin and constructed paths.
  const response=await fetch('https://api.github.com'+path,{
    method:options.method||'GET',
    headers:{'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'github-multi-connect', ...(options.body?{'Content-Type':'application/json'}:{})},
    body:options.body?JSON.stringify(options.body):undefined,
    redirect:'error',
    signal:AbortSignal.timeout(12000)
  });
  if(!response.ok) throw new PublicError('GitHub request failed (HTTP '+response.status+'). Check this owner\'s Token permissions.');
  const raw=await response.text(); if(raw.length>180000) throw new PublicError('GitHub response too large');
  try {return JSON.parse(raw);} catch {throw new PublicError('Invalid response from GitHub');}
}
export async function getOwnerToken(env,owner) {
  if(!validOwner(owner)) throw new PublicError('Invalid GitHub owner');
  const row=await env.GITHUB_DB.prepare('SELECT owner,key_id,iv,ciphertext FROM github_connections WHERE owner=? AND enabled=1').bind(owner.toLowerCase()).first();
  if(!row) throw new PublicError('No enabled GitHub connection configured for owner '+owner);
  // Absolutely no other owner or global Token fallback.
  return unseal(env,row);
}
export function redact(s) {
  return String(s)
    .replace(/github_pat_[A-Za-z0-9_]{15,}/g,'[REDACTED_GITHUB_TOKEN]')
    .replace(/gh[pousr]_[A-Za-z0-9_]{20,}/g,'[REDACTED_GITHUB_TOKEN]')
    .replace(/(Bearer\s+)[^\s"']+/gi,'$1[REDACTED]')
    .replace(/(authorization\s*[:=]\s*)[^\s,;"']+/gi,'$1[REDACTED]');
}
export function summarize(kind,data) {
  if(kind==='repo') return {full_name:data.full_name,private:data.private,description:data.description,default_branch:data.default_branch,open_issues_count:data.open_issues_count,html_url:data.html_url,pushed_at:data.pushed_at};
  if(kind==='issue') return {number:data.number,title:data.title,state:data.state,body:data.body,html_url:data.html_url,created_at:data.created_at,updated_at:data.updated_at,user:data.user?.login};
  if(kind==='issues') return data.filter(v=>!v.pull_request).map(v=>({number:v.number,title:v.title,state:v.state,html_url:v.html_url,updated_at:v.updated_at}));
  if(kind==='pull') return {number:data.number,title:data.title,state:data.state,merged:data.merged,body:data.body,html_url:data.html_url,base:data.base?.ref,head:data.head?.ref,updated_at:data.updated_at};
  if(kind==='pulls') return data.map(v=>({number:v.number,title:v.title,state:v.state,html_url:v.html_url,base:v.base?.ref,head:v.head?.ref,updated_at:v.updated_at}));
  if(kind==='file') {
    if(data.type!=='file' || data.encoding!=='base64' || data.size>25000) throw new PublicError('Not a supported file or file is too large');
    return {path:data.path,sha:data.sha,encoding:'base64',content:data.content};
  }
  return data;
}

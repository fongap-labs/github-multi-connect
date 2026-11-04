import {validOwner,validRepo} from './util.ts';
import {unseal} from './crypto.ts';
import type {Env} from './types.ts';
import {McpPublicError} from './gateway/errors.ts';
import {redact} from './gateway/redaction.ts';

export class PublicError extends McpPublicError { constructor(message: string) {super(message);this.name='PublicError';} }
export {redact};
export type GitHubKind = 'owner_identity' | 'repo' | 'issues' | 'issue' | 'pulls' | 'pull' | 'file';
export interface GitHubPathArgs {
  owner: string;
  repo?: string;
  kind: GitHubKind;
  number?: number;
  path?: string;
  ref?: string;
  state?: string;
  per_page?: number;
}
export function githubPath({owner,repo,kind,number,path,ref,state,per_page}: GitHubPathArgs): string {
  if(!validOwner(owner)) throw new PublicError('Invalid GitHub owner');
  const root='/repos/'+encodeURIComponent(owner);
  if(kind==='owner_identity') return '/users/'+encodeURIComponent(owner);
  if(!validRepo(repo)) throw new PublicError('Invalid repository name');
  const base=root+'/'+encodeURIComponent(repo);
  if(kind==='repo') return base;
  if(kind==='issues') return base+'/issues?'+new URLSearchParams({state:state && ['open','closed','all'].includes(state)?state:'open',per_page:String(Math.min(50,Math.max(1,Number(per_page)||20)))});
  if(kind==='issue') {if(!Number.isSafeInteger(number)||!number||number<1) throw new PublicError('Invalid issue number'); return base+'/issues/'+number;}
  if(kind==='pulls') return base+'/pulls?'+new URLSearchParams({state:state && ['open','closed','all'].includes(state)?state:'open',per_page:String(Math.min(50,Math.max(1,Number(per_page)||20)))});
  if(kind==='pull') {if(!Number.isSafeInteger(number)||!number||number<1) throw new PublicError('Invalid pull request number'); return base+'/pulls/'+number;}
  if(kind==='file') {
    if(typeof path!=='string'||path.length>1000||path.startsWith('/')||path.split('/').some(x=>!x||x==='.'||x==='..'||/[\\\0-\x1f]/.test(x))) throw new PublicError('Invalid file path');
    const target=base+'/contents/'+path.split('/').map(encodeURIComponent).join('/');
    return ref ? target+'?'+new URLSearchParams({ref:String(ref).slice(0,100)}) : target;
  }
  throw new PublicError('Unsupported operation');
}
export interface GitHubApiOptions { method?: 'GET'|'POST'; body?: Record<string, unknown> }
export interface GitHubResponse { [key: string]: unknown; full_name?: string; private?: boolean; description?: string; default_branch?: string; login?: string; type?: string; number?: number; title?: string; html_url?: string; state?: string; }
const obj=(value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const field=(value: unknown, key: string): unknown => obj(value)[key];
export async function apiFetch<T = GitHubResponse>(token: string,path: string,options: GitHubApiOptions={}): Promise<T> {
  const response=await fetch('https://api.github.com'+path,{
    method:options.method||'GET',
    headers:{'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'mcp-hub', ...(options.body?{'Content-Type':'application/json'}:{})},
    body:options.body?JSON.stringify(options.body):undefined,
    redirect:'error',
    signal:AbortSignal.timeout(12000)
  });
  if(!response.ok) throw new PublicError('GitHub request failed (HTTP '+response.status+'). Check this owner\'s Token permissions.');
  const raw=await response.text(); if(raw.length>180000) throw new PublicError('GitHub response too large');
  try {return JSON.parse(raw) as T;} catch {throw new PublicError('Invalid response from GitHub');}
}
export async function getOwnerToken(env: Env,owner: string): Promise<string> {
  if(!validOwner(owner)) throw new PublicError('Invalid GitHub owner');
  const row=await env.MCP_DB.prepare('SELECT owner,key_id,iv,ciphertext FROM github_connections WHERE owner=? AND enabled=1').bind(owner.toLowerCase()).first();
  if(!row) throw new PublicError('No enabled GitHub connection configured for owner '+owner);
  return unseal(env,row);
}
export function summarize(kind: GitHubKind, data: unknown): unknown {
  if(kind==='repo') return {full_name:field(data,'full_name'),private:field(data,'private'),description:field(data,'description'),default_branch:field(data,'default_branch'),open_issues_count:field(data,'open_issues_count'),html_url:field(data,'html_url'),pushed_at:field(data,'pushed_at')};
  if(kind==='issue') return {number:field(data,'number'),title:field(data,'title'),state:field(data,'state'),body:field(data,'body'),html_url:field(data,'html_url'),created_at:field(data,'created_at'),updated_at:field(data,'updated_at'),user:field(field(data,'user'),'login')};
  if(kind==='issues') return (Array.isArray(data)?data:[]).filter(v=>!field(v,'pull_request')).map(v=>({number:field(v,'number'),title:field(v,'title'),state:field(v,'state'),html_url:field(v,'html_url'),updated_at:field(v,'updated_at')}));
  if(kind==='pull') return {number:field(data,'number'),title:field(data,'title'),state:field(data,'state'),merged:field(data,'merged'),body:field(data,'body'),html_url:field(data,'html_url'),base:field(field(data,'base'),'ref'),head:field(field(data,'head'),'ref'),updated_at:field(data,'updated_at')};
  if(kind==='pulls') return (Array.isArray(data)?data:[]).map(v=>({number:field(v,'number'),title:field(v,'title'),state:field(v,'state'),html_url:field(v,'html_url'),base:field(field(v,'base'),'ref'),head:field(field(v,'head'),'ref'),updated_at:field(v,'updated_at')}));
  if(kind==='file') {
    if(field(data,'type')!=='file' || field(data,'encoding')!=='base64' || Number(field(data,'size'))>25000) throw new PublicError('Not a supported file or file is too large');
    return {path:field(data,'path'),sha:field(data,'sha'),encoding:'base64',content:field(data,'content')};
  }
  return data;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyProvenance } from '../scripts/verify-deploy-provenance.mjs';
import { prepareWorkerSecrets, WORKER_SECRET_NAMES } from '../scripts/prepare-worker-secrets.mjs';

const sha = 'a'.repeat(40);
const repo = 'fongap-labs/mcp-hub';
const token = 'synthetic-token-for-test';
const env = { GITHUB_REPOSITORY: repo, GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha, GITHUB_TOKEN: token };
const origin = 'https://api.github.com/repos/';
const control = 'fongap-labs/action-worker';
const signed = (name, runId) => ({
  context: name,
  state: 'success',
  description: `${name} verified [aw1:${'A'.repeat(43)}]`,
  target_url: `https://github.com/${control}/actions/runs/${runId}`,
});
function fixtures() {
  return new Map([
    [`${repo}/commits/main`, {sha}],
    [`${repo}/commits/${sha}/status`, {statuses: [signed('CI Evidence', 100), signed('Main Write Guard', 101)]}],
    [`${repo}/commits/${sha}/pulls?per_page=100`, [{number:6, merged_at:'2026-11-04T07:00:00Z', merge_commit_sha:sha, base:{ref:'main'}}]],
    [`${control}/actions/runs/100`, {path:'.github/workflows/central-ci-dispatch.yml',event:'repository_dispatch',status:'completed',conclusion:'success'}],
    [`${control}/actions/runs/100/jobs?per_page=100`, {jobs:[{name:'Publish Central CI',conclusion:'success'}]}],
    [`${control}/actions/runs/101`, {path:'.github/workflows/intake.yml',event:'repository_dispatch',status:'completed',conclusion:'success'}],
    [`${control}/actions/runs/101/jobs?per_page=100`, {jobs:[{name:'Main write audit',conclusion:'success'}]}],
  ]);
}
const fakeFetch = (map) => async (url, options) => {
  assert.ok(url.startsWith(origin));
  const key=url.slice(origin.length);
  if(key.startsWith(repo)) assert.equal(options.headers.Authorization, `Bearer ${token}`);
  else assert.equal(options.headers.Authorization, undefined);
  const body=map.get(key);
  return {ok:body!==undefined,status:body!==undefined?200:404,json:async()=>body};
};

test('source deploy validates both signed central statuses and their successful authoritative jobs',async()=>{
  assert.equal(await verifyProvenance(env,fakeFetch(fixtures())),sha);
});
test('source deploy refuses untrusted repository, stale or non-main SHA',async()=>{
  const cases=[{GITHUB_REPOSITORY:'fongap-labs/action-worker'},{GITHUB_REF:'refs/heads/feature'},{GITHUB_SHA:'main'}];
  for(const change of cases) await assert.rejects(verifyProvenance({...env,...change},fakeFetch(fixtures())));
  const stale=fixtures();stale.set(`${repo}/commits/main`,{sha:'b'.repeat(40)});
  await assert.rejects(verifyProvenance(env,fakeFetch(stale)),/Source main moved/);
});
test('source deploy rejects spoofed, failed or mismatched central evidence',async()=>{
  for(const mutate of [
    m=>m.get(`${repo}/commits/${sha}/status`).statuses[0].state='failure',
    m=>m.get(`${repo}/commits/${sha}/status`).statuses[0].description='not signed',
    m=>m.get(`${repo}/commits/${sha}/status`).statuses[0].target_url='https://github.com/attacker/action-worker/actions/runs/100',
    m=>m.get(`${control}/actions/runs/100`).conclusion='failure',
    m=>m.get(`${control}/actions/runs/101`).path='.github/workflows/untrusted.yml',
    m=>m.get(`${control}/actions/runs/101/jobs?per_page=100`).jobs[0].conclusion='failure',
    m=>m.set(`${repo}/commits/${sha}/pulls?per_page=100`,[]),
  ]){const data=fixtures();mutate(data);await assert.rejects(verifyProvenance(env,fakeFetch(data)));}
});
test('worker secret bundle is complete and never logs or silently overwrites',()=>{
  const vars=Object.fromEntries(WORKER_SECRET_NAMES.map(name=>[name,`${name}_synthetic`]));
  let saved;
  const count=prepareWorkerSecrets(vars,'/temporary/worker-secrets.json',(path,body,options)=>{saved={path,body,options};});
  assert.equal(count,5);
  assert.deepEqual(JSON.parse(saved.body),vars);
  assert.deepEqual(saved.options,{mode:0o600,flag:'wx'});
  assert.throws(()=>prepareWorkerSecrets({...vars,MCP_ADMIN_KEY:''},'/temporary/secrets.json'),/MCP_ADMIN_KEY/);
  assert.throws(()=>prepareWorkerSecrets(vars,'secrets.json'),/Absolute secret file/);
});

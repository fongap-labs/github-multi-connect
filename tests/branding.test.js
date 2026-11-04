import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {BRAND_ICON,BRAND_NAME,BRAND_NOTE,BRAND_SOURCE,BRAND_VERSION} from '../src/brand.js';
import {processMcp} from '../src/mcp.js';

const origin='https://test.example';
test('independent mark and administration UI cannot be confused with official GitHub MCP',async()=>{
  assert.equal(BRAND_NAME,'GitHub Multi Connect');
  assert.equal(BRAND_SOURCE,'Fongap Labs');
  assert.equal(BRAND_VERSION,'v0.1.0');
  assert.match(BRAND_ICON,/#[2][8]6F78/i);
  assert.doesNotMatch(BRAND_ICON,/octocat|invertocat|fontawesome/i);
  const icon=await worker.fetch(new Request(origin+'/brand/icon.svg'),{});
  assert.equal(icon.status,200);
  assert.match(icon.headers.get('Content-Type'),/image\/svg\+xml/);
  assert.match(await icon.text(),/GitHub Multi Connect independent mark/);
  const login=await worker.fetch(new Request(origin+'/admin'),{});
  assert.equal(login.status,200);
  const html=await login.text();
  assert.match(html,/GitHub Multi Connect/);
  assert.match(html,/非 GitHub 官方 MCP Server/);
  assert.match(html,/Fongap Labs/);
  assert.match(html,/v0\.1\.0/);
  assert.match(html,/\/brand\/icon.svg/);
  assert.doesNotMatch(html,/<h1>GitHub MCP 管理/);
  assert.match(BRAND_NOTE,/独立开发/);
});

test('MCP initialize identifies an independent gateway, not the official server',async()=>{
  const request=new Request(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}})});
  const response=await processMcp(request,{}, {scopes:['mcp:read']});
  const payload=await response.json();
  assert.equal(payload.result.serverInfo.name,'github-multi-connect');
  assert.match(payload.result.serverInfo.title,/Independent/);
  assert.match(payload.result.serverInfo.title,/Fongap Labs/);
  assert.equal(payload.result.serverInfo.version,'0.1.0');
  assert.match(payload.result.instructions,/NOT the official GitHub MCP Server/);
  assert.notEqual(payload.result.serverInfo.name,'github-mcp-server');
});

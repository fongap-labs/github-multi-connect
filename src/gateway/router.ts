import type { Env, McpAuth, DataObject } from '../types.ts';
import type { McpServer } from './types.ts';
import { McpPublicError } from './errors.ts';
import { redact } from './redaction.ts';
import { BRAND_NAME, BRAND_SOURCE, BRAND_VERSION } from '../brand.ts';
import { json } from '../util.ts';
import { toolPolicyId } from './registry.ts';

type RpcId = string | number | null;

function rpcResult(id: RpcId, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: RpcId, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function resultText(data: unknown) {
  return { content: [{ type: 'text', text: redact(JSON.stringify(data)) }] };
}

function toolError(message: string) {
  return { isError: true, content: [{ type: 'text', text: redact(message) }] };
}

export async function processMcp(request: Request, env: Env, auth: McpAuth, server: McpServer): Promise<Response> {
  if (request.method === 'GET' || request.method === 'DELETE') return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(request.headers.get('Content-Type') || '').toLowerCase().includes('application/json')) return json({ error: 'Content type must be application/json' }, 415);
  const len = Number(request.headers.get('Content-Length') || '0');
  if (len > 65536) return json({ error: 'Request too large' }, 413);
  let parsed: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 65536) throw new Error('Request too large');
    parsed = JSON.parse(raw);
  } catch {
    return json(rpcError(null, -32700, 'Parse error'));
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return json(rpcError(null, -32600, 'Invalid request'));
  const rpc = parsed as DataObject;
  if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') return json(rpcError(null, -32600, 'Invalid request'));
  const id = Object.hasOwn(rpc, 'id') ? rpc.id : undefined;
  if (id !== undefined && typeof id !== 'number' && typeof id !== 'string') return json(rpcError(null, -32600, 'Invalid request'));
  if (id === undefined) return new Response(null, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  if (!auth.scopes.includes('mcp:read')) return json(rpcError(id, -32001, 'Insufficient scope'), 403);
  if (!auth.allowedResources.includes(server.id)) return json(rpcError(id, -32001, 'Resource is not authorized'), 403);

  if (rpc.method === 'initialize') {
    const params = rpc.params && typeof rpc.params === 'object' && !Array.isArray(rpc.params) ? rpc.params as DataObject : {};
    const supported = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'];
    const requestedVersion = params.protocolVersion;
    const version = typeof requestedVersion === 'string' && supported.includes(requestedVersion) ? requestedVersion : '2025-11-25';
    return json(rpcResult(id, {
      protocolVersion: version,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: server.name, title: `${BRAND_NAME} · ${server.title} · ${BRAND_SOURCE} (Independent)`, version: BRAND_VERSION.slice(1) },
      instructions: `${server.module.description} ${server.module.instructions}`,
    }));
  }
  if (rpc.method === 'ping') return json(rpcResult(id, {}));
  const allowedTools = server.module.listTools(env, auth).filter(tool => auth.allowedTools.includes(toolPolicyId(server.module.id, tool.name)));
  if (rpc.method === 'tools/list') return json(rpcResult(id, { tools: allowedTools }));
  if (rpc.method === 'tools/call') {
    const params = rpc.params && typeof rpc.params === 'object' && !Array.isArray(rpc.params) ? rpc.params as DataObject : {};
    const name = params.name;
    if (typeof name !== 'string' || !allowedTools.some(tool => tool.name === name)) return json(rpcError(id, -32602, 'Unknown or unauthorized tool'));
    const args = params.arguments || {};
    try {
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new McpPublicError('Invalid arguments');
      const result = await server.module.callTool(name, args as DataObject, env, auth);
      return json(rpcResult(id, resultText(result)));
    } catch (error) {
      return json(rpcResult(id, toolError(error instanceof McpPublicError ? error.message : 'Operation failed')));
    }
  }
  return json(rpcError(id, -32601, 'Method not found'));
}

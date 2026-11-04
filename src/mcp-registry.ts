import type { Env, McpAuth } from './types.ts';
import {processMcp} from './mcp.ts';

export interface McpServer {
  readonly id: string;
  readonly path: string;
  readonly resourcePath: string;
  readonly metadataPath: string;
  readonly name: string;
  readonly title: string;
  readonly handle: (request: Request, env: Env, auth: McpAuth, server: McpServer) => Promise<Response>;
}

// Each entry is a distinct OAuth resource, even when two services happen to
// expose the same tools. New MCPs must be explicitly registered here.
export const MCP_SERVERS: readonly McpServer[] = Object.freeze([
  {
    id: 'default',
    path: '/',
    resourcePath: '',
    metadataPath: '/.well-known/oauth-protected-resource',
    name: 'mcp-hub',
    title: 'Default MCP (GitHub module)',
    handle: processMcp,
  },
  {
    id: 'github',
    path: '/github',
    resourcePath: '/github',
    metadataPath: '/.well-known/oauth-protected-resource/github',
    name: 'mcp-hub-github',
    title: 'GitHub MCP',
    handle: processMcp,
  },
]);

export function baseOrigin(env: Env): string {
  const url = new URL(env.MCP_PUBLIC_URL);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('MCP_PUBLIC_URL must use HTTPS');
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('MCP_PUBLIC_URL must be an origin without a path');
  }
  return url.origin;
}

export function resourceForServer(env: Env, server: McpServer): string {
  return baseOrigin(env) + server.resourcePath;
}

export function serverForPath(path: string): McpServer | undefined {
  return MCP_SERVERS.find(server => server.path === path);
}

export function serverForMetadata(path: string): McpServer | undefined {
  return MCP_SERVERS.find(server => server.metadataPath === path);
}

export function serverForResource(env: Env, resource: string | null): McpServer | undefined {
  if (!resource) return undefined;
  return MCP_SERVERS.find(server => resourceForServer(env, server) === resource);
}

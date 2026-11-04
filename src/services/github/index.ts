import type { McpModule } from '../../gateway/types.ts';
import { callGitHubTool, listGitHubTools } from './tools.ts';
import { BRAND_SOURCE } from '../../brand.ts';

export const githubModule: McpModule = Object.freeze({
  id: 'github',
  description: `Independent third-party multi-account gateway by ${BRAND_SOURCE}, NOT the official GitHub MCP Server.`,
  instructions: 'GitHub owner selects the matching server-held credential. Tokens cannot be read or returned by tools. GitHub writes and raw file contents are disabled by default.',
  endpoints: Object.freeze([
    Object.freeze({
      id: 'default',
      path: '/',
      resourcePath: '',
      metadataPath: '/.well-known/oauth-protected-resource',
      name: 'mcp-hub',
      title: 'Default MCP (GitHub module)',
    }),
    Object.freeze({
      id: 'github',
      path: '/github',
      resourcePath: '/github',
      metadataPath: '/.well-known/oauth-protected-resource/github',
      name: 'mcp-hub-github',
      title: 'GitHub MCP',
    }),
  ]),
  listTools: listGitHubTools,
  callTool: callGitHubTool,
});

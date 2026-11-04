import type { Env, McpAuth, DataObject } from '../types.ts';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpEndpointDefinition {
  readonly id: string;
  readonly path: string;
  readonly resourcePath: string;
  readonly metadataPath: string;
  readonly name: string;
  readonly title: string;
}

export interface McpModule {
  readonly id: string;
  readonly description: string;
  readonly instructions: string;
  readonly endpoints: readonly McpEndpointDefinition[];
  readonly listTools: (env: Env, auth: McpAuth) => readonly McpTool[];
  readonly callTool: (name: string, args: DataObject, env: Env, auth: McpAuth) => Promise<unknown>;
}

export interface McpServer extends McpEndpointDefinition {
  readonly module: McpModule;
}

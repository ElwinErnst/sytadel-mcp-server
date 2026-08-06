#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { SytadelClient } from './sytadel-client.js';

// Log to stderr — MCP owns stdout for the JSON-RPC framing.
function log(...args: unknown[]): void {
  console.error('[sytadel-mcp]', ...args);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new SytadelClient(config);
  const server = buildServer(client);
  const transport = new StdioServerTransport();

  log(
    `starting stdio server: auth=${config.authApiUrl} zt=${config.ztApiUrl} tenant=${config.tenantSlug}`,
  );

  await server.connect(transport);
  log('connected — awaiting MCP client');
}

main().catch((err) => {
  console.error('[sytadel-mcp] fatal:', err);
  process.exit(1);
});

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { SytadelClient } from './sytadel-client.js';
import { TOOLS } from './tools.js';

/**
 * Register the tool list + call handlers against a plain MCP Server.
 * Transport-agnostic — the caller decides whether to run it over stdio,
 * SSE or a custom pipe. That keeps the wiring in bin/index easy to swap.
 */
export function buildServer(client: SytadelClient): Server {
  const server = new Server(
    { name: 'sytadel-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema, { target: 'openApi3' }),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [
          { type: 'text', text: `Unknown tool: ${req.params.name}` },
        ],
      };
    }

    try {
      const parsed = tool.inputSchema.parse(req.params.arguments ?? {});
      const result = await tool.run(client, parsed);
      return {
        content: [
          { type: 'text', text: JSON.stringify(result, null, 2) },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
      };
    }
  });

  return server;
}

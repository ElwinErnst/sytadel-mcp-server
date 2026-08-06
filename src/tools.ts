import { z } from 'zod';
import type { SytadelClient } from './sytadel-client.js';

/**
 * Every tool has:
 * - `name`, `description`: what the model sees when deciding whether to call it.
 * - `inputSchema`: Zod schema converted to JSON schema for the MCP handshake.
 * - `run(client, input)`: the actual work. Returns a plain object; the caller
 *   wraps it as text content for the MCP response.
 *
 * Kept as a plain array (not a class) so registration in server.ts is a
 * one-liner and testing individual tools needs no framework at all.
 */
export type ToolDef = {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  run: (client: SytadelClient, input: unknown) => Promise<unknown>;
};

const listTenantUsers: ToolDef = {
  name: 'list_tenant_users',
  description:
    'List all users of the current Sytadel tenant with their role, active flag, passkey count, and last login. Useful for access reviews and off-boarding checks.',
  inputSchema: z.object({}).strict(),
  async run(client) {
    const me = await client.getMe();
    return client.listTenantMemberships(me.tenant.id);
  },
};

const listServiceAccounts: ToolDef = {
  name: 'list_service_accounts',
  description:
    'List service accounts (machine credentials) under every client app of the current tenant, with last-used timestamps and auto-rotation state. Useful for spotting dormant integrations.',
  inputSchema: z.object({}).strict(),
  async run(client) {
    const me = await client.getMe();
    return client.listClientApps(me.tenant.id);
  },
};

const querySessionAnomalies: ToolDef = {
  name: 'query_session_anomalies',
  description:
    'Return recent session anomaly events (login from new IP / new country / new device / high score) for the calling user, up to `limit` rows. Ordered newest first.',
  inputSchema: z
    .object({
      limit: z.number().int().min(1).max(200).default(50),
    })
    .strict(),
  async run(client, input) {
    const parsed = z
      .object({ limit: z.number().int().min(1).max(200).default(50) })
      .parse(input);
    return client.listSessionAnomalies(parsed.limit);
  },
};

const generatePolicy: ToolDef = {
  name: 'generate_policy',
  description:
    'Compile a natural-language RBAC intent (e.g. "OWNER can do anything, MEMBER can only GET /vaults, default deny") into a Sytadel PolicySet JSON. Returns policy, warnings, cost, tokens, latency. Read-only: the compiled policy is NOT applied — call PUT /policies/:tenantId separately to enforce it.',
  inputSchema: z
    .object({
      intent: z.string().min(3).max(1000),
    })
    .strict(),
  async run(client, input) {
    const parsed = z.object({ intent: z.string().min(3).max(1000) }).parse(input);
    return client.generatePolicy(parsed.intent);
  },
};

const runAccessReview: ToolDef = {
  name: 'run_access_review',
  description:
    'Trigger an on-demand AI-driven access review for the current tenant. Claude reviews users, service accounts and recent anomalies, and returns a markdown report plus a machine-readable list of recommendations (revoke, downgrade, disable_service_account, rotate_service_account_secret, delete_passkey, require_password_reset, review_manually).',
  inputSchema: z.object({}).strict(),
  async run(client) {
    const me = await client.getMe();
    await client.runAccessReview(me.tenant.id);
    // The run itself only returns metadata; the full report lives at /latest.
    return client.getLatestAccessReview(me.tenant.id);
  },
};

export const TOOLS: ToolDef[] = [
  listTenantUsers,
  listServiceAccounts,
  querySessionAnomalies,
  generatePolicy,
  runAccessReview,
];

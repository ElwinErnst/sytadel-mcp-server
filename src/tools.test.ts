import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS } from './tools.js';

/**
 * Security-focused tests for the tool surface. The central guarantee is that a
 * (potentially adversarial) model cannot make a tool act on a tenant it does
 * not own: no tool accepts a tenant/target identifier, and the tenant is always
 * derived from the authenticated principal via client.getMe().
 */

const EXPECTED_TOOLS = [
  'generate_policy',
  'list_service_accounts',
  'list_tenant_users',
  'query_session_anomalies',
  'run_access_review',
];

// Identifiers a malicious model might try to smuggle in to act cross-tenant.
const FOREIGN_IDENTIFIER_KEYS = [
  'tenantId',
  'tenant',
  'tenant_id',
  'userId',
  'targetTenantId',
  'org',
];

test('exposes exactly the expected tools, with unique names', () => {
  const names = TOOLS.map((t) => t.name).sort();
  assert.deepEqual(names, EXPECTED_TOOLS);
  assert.equal(new Set(names).size, TOOLS.length);
});

test('no tool accepts a tenant/target identifier as input (anti cross-tenant injection)', () => {
  for (const tool of TOOLS) {
    for (const key of FOREIGN_IDENTIFIER_KEYS) {
      const res = tool.inputSchema.safeParse({ [key]: 'attacker-controlled' });
      assert.equal(
        res.success,
        false,
        `${tool.name} must reject unknown input key "${key}"`,
      );
    }
  }
});

test('tenant is derived from the authenticated principal, not from tool input', async () => {
  const PRINCIPAL_TENANT = 'tenant-from-jwt';
  const calls: Record<string, unknown[]> = {};
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls[name] = args;
      return Promise.resolve([]);
    };

  const fakeClient = {
    getMe: () => Promise.resolve({ tenant: { id: PRINCIPAL_TENANT } }),
    listTenantMemberships: record('listTenantMemberships'),
    listClientApps: record('listClientApps'),
    runAccessReview: record('runAccessReview'),
    getLatestAccessReview: record('getLatestAccessReview'),
  } as never;

  const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

  // Even when the (ignored) input carries a foreign tenant, the principal wins.
  await byName['list_tenant_users']!.run(fakeClient, { tenantId: 'attacker' });
  assert.deepEqual(calls['listTenantMemberships'], [PRINCIPAL_TENANT]);

  await byName['list_service_accounts']!.run(fakeClient, { tenantId: 'attacker' });
  assert.deepEqual(calls['listClientApps'], [PRINCIPAL_TENANT]);

  await byName['run_access_review']!.run(fakeClient, { tenantId: 'attacker' });
  assert.deepEqual(calls['runAccessReview'], [PRINCIPAL_TENANT]);
  assert.deepEqual(calls['getLatestAccessReview'], [PRINCIPAL_TENANT]);
});

test('query_session_anomalies enforces its limit bounds', () => {
  const schema = TOOLS.find((t) => t.name === 'query_session_anomalies')!
    .inputSchema;
  assert.equal(schema.safeParse({ limit: 50 }).success, true);
  assert.equal(schema.safeParse({ limit: 0 }).success, false);
  assert.equal(schema.safeParse({ limit: 5000 }).success, false);
  assert.equal(schema.safeParse({}).success, true); // defaulted
});

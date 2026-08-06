/**
 * The MCP server supports two auth modes, picked by which env vars are set:
 *
 * - `user`  → SYTADEL_USER_EMAIL + SYTADEL_USER_PASSWORD.  Full role scope
 *             (OWNER / ADMIN capabilities). Right choice for an operator's
 *             chat client where the operator IS the admin.
 * - `sa`    → SYTADEL_CLIENT_APP_ID + SYTADEL_SERVICE_ACCOUNT_ID +
 *             SYTADEL_SERVICE_ACCOUNT_SECRET.  Restricted to the API_CLIENT
 *             role — appropriate for read-only or API-scoped surfaces.
 *
 * User mode wins if both are configured, on the assumption that the operator
 * meant the more capable one.
 */
export type SytadelConfig = {
  authApiUrl: string;
  ztApiUrl: string;
  tenantSlug: string;
  auth:
    | { mode: 'user'; email: string; password: string }
    | {
        mode: 'sa';
        clientAppId: string;
        serviceAccountId: string;
        serviceAccountSecret: string;
      };
  requestTimeoutMs: number;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. See README.md for setup.`,
    );
  }
  return value;
}

export function loadConfig(): SytadelConfig {
  const tenantSlug = requireEnv('SYTADEL_TENANT_SLUG');

  const email = process.env.SYTADEL_USER_EMAIL;
  const password = process.env.SYTADEL_USER_PASSWORD;
  const saId = process.env.SYTADEL_SERVICE_ACCOUNT_ID;
  const saSecret = process.env.SYTADEL_SERVICE_ACCOUNT_SECRET;
  const clientAppId = process.env.SYTADEL_CLIENT_APP_ID;

  let auth: SytadelConfig['auth'];
  if (email && password) {
    auth = { mode: 'user', email, password };
  } else if (clientAppId && saId && saSecret) {
    auth = {
      mode: 'sa',
      clientAppId,
      serviceAccountId: saId,
      serviceAccountSecret: saSecret,
    };
  } else {
    throw new Error(
      'Missing auth credentials. Set either SYTADEL_USER_EMAIL + SYTADEL_USER_PASSWORD, or SYTADEL_CLIENT_APP_ID + SYTADEL_SERVICE_ACCOUNT_ID + SYTADEL_SERVICE_ACCOUNT_SECRET. See README.md.',
    );
  }

  return {
    authApiUrl: process.env.SYTADEL_AUTH_API_URL ?? 'http://localhost:3002/api',
    ztApiUrl: process.env.SYTADEL_ZT_API_URL ?? 'http://localhost:3010',
    tenantSlug,
    auth,
    // Default generous — access-review + policy generation call Claude on
    // the backend, so per-request wall time is dominated by the LLM.
    requestTimeoutMs: Number(process.env.SYTADEL_TIMEOUT_MS ?? 60000),
  };
}

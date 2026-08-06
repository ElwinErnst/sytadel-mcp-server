import type { SytadelConfig } from './config.js';

/**
 * Minimal, dependency-free JWT payload decoder. We do NOT verify the
 * signature here — verification happens server-side on every call. All we
 * need locally is the claims that identify the tenant and the subject.
 */
function decodeJwt(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const pad = payload.length % 4 === 0 ? '' : '='.repeat(4 - (payload.length % 4));
  return JSON.parse(Buffer.from(payload + pad, 'base64').toString('utf-8'));
}

type TokenCache = {
  accessToken: string;
  expiresAt: number; // ms since epoch
};

/**
 * Thin HTTP client that authenticates against Sytadel with a service
 * account credential pair, caches the access token until ~60s before its
 * expiry, and offers typed helpers per tool. No third-party HTTP libraries
 * on purpose — the MCP surface stays small and dependency-free.
 */
export class SytadelClient {
  private tokenCache: TokenCache | null = null;
  private inflightAuth: Promise<TokenCache> | null = null;

  constructor(private readonly config: SytadelConfig) {}

  // ── Auth ────────────────────────────────────────────────────────

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return this.tokenCache.accessToken;
    }
    // Coalesce concurrent auth calls — MCP tools can fire in parallel.
    if (!this.inflightAuth) {
      this.inflightAuth = this.issueToken().finally(() => {
        this.inflightAuth = null;
      });
    }
    const fresh = await this.inflightAuth;
    return fresh.accessToken;
  }

  private async issueToken(): Promise<TokenCache> {
    if (this.config.auth.mode === 'user') {
      // Password login mirrors what a real operator would do in the console.
      const res = await this.fetchJson<{
        accessToken: string;
        accessTokenExpiresIn: number;
      }>(`${this.config.authApiUrl}/auth/login`, {
        method: 'POST',
        body: JSON.stringify({
          email: this.config.auth.email,
          password: this.config.auth.password,
          tenantSlug: this.config.tenantSlug,
        }),
      });
      const cache: TokenCache = {
        accessToken: res.accessToken,
        expiresAt: Date.now() + res.accessTokenExpiresIn * 1000,
      };
      this.tokenCache = cache;
      return cache;
    }

    // Service-account credentials — restricted API_CLIENT scope.
    const body = {
      tenantSlug: this.config.tenantSlug,
      clientAppId: this.config.auth.clientAppId,
      serviceAccountId: this.config.auth.serviceAccountId,
      clientSecret: this.config.auth.serviceAccountSecret,
    };
    const res = await this.fetchJson<{
      accessToken: string;
      accessTokenExpiresIn: number;
      tokenType: 'Bearer';
    }>(`${this.config.authApiUrl}/integrations/service-account-token`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const cache: TokenCache = {
      accessToken: res.accessToken,
      expiresAt: Date.now() + res.accessTokenExpiresIn * 1000,
    };
    this.tokenCache = cache;
    return cache;
  }

  // ── Public tool-facing helpers ──────────────────────────────────

  async listTenantMemberships(tenantId: string): Promise<unknown[]> {
    return this.authGet<unknown[]>(`/tenants/${tenantId}/memberships`);
  }

  async listClientApps(tenantId: string): Promise<unknown[]> {
    return this.authGet<unknown[]>(`/tenants/${tenantId}/client-apps`);
  }

  async listSessionAnomalies(limit: number): Promise<unknown[]> {
    const qs = limit ? `?limit=${limit}` : '';
    return this.authGet<unknown[]>(`/sessions/anomalies${qs}`);
  }

  async generatePolicy(intent: string): Promise<unknown> {
    // ZT gateway endpoint — public in this build, but we still route
    // through the same client for consistency and easy header injection
    // when we add auth in front of it.
    return this.request<unknown>({
      method: 'POST',
      url: `${this.config.ztApiUrl}/policies/generate`,
      body: JSON.stringify({ intent }),
    });
  }

  async runAccessReview(tenantId: string): Promise<unknown> {
    return this.authPost<unknown>(
      `/tenants/${tenantId}/access-review/run`,
      {},
    );
  }

  async getLatestAccessReview(tenantId: string): Promise<unknown> {
    return this.authGet<unknown>(`/tenants/${tenantId}/access-review/latest`);
  }

  /**
   * Resolves the caller's tenant + subject from the current JWT.
   *
   * We do NOT call /auth/me here: service-account JWTs point at a
   * synthetic subject that isn't a User row, so /auth/me would 404. The
   * JWT itself already carries `tenantId` + `sub` + `actorType`, which
   * is what tools actually need.
   */
  async getMe(): Promise<{
    tenant: { id: string; slug: string };
    subjectId: string;
    actorType: 'user' | 'service_account';
  }> {
    const token = await this.getToken();
    const payload = decodeJwt(token);
    return {
      tenant: {
        id: String(payload.tenantId ?? ''),
        slug: this.config.tenantSlug,
      },
      subjectId: String(payload.sub ?? ''),
      actorType: (payload.actorType as 'user' | 'service_account') ?? 'service_account',
    };
  }

  // ── Internals ───────────────────────────────────────────────────

  private async authGet<T>(path: string): Promise<T> {
    const token = await this.getToken();
    return this.request<T>({
      method: 'GET',
      url: `${this.config.authApiUrl}${path}`,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  private async authPost<T>(path: string, body: unknown): Promise<T> {
    const token = await this.getToken();
    return this.request<T>({
      method: 'POST',
      url: `${this.config.authApiUrl}${path}`,
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(body ?? {}),
    });
  }

  private async fetchJson<T>(
    url: string,
    init: { method: string; body?: string; headers?: Record<string, string> },
  ): Promise<T> {
    return this.request<T>({
      method: init.method,
      url,
      headers: init.headers,
      body: init.body,
    });
  }

  private async request<T>(input: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.requestTimeoutMs,
    );
    try {
      const res = await fetch(input.url, {
        method: input.method,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(input.headers ?? {}),
        },
        body: input.body,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(
          `Sytadel ${input.method} ${new URL(input.url).pathname} → ${res.status}: ${text.slice(0, 300)}`,
        );
      }
      return text ? (JSON.parse(text) as T) : (undefined as T);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          `Sytadel ${input.method} ${input.url} timed out after ${this.config.requestTimeoutMs}ms`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

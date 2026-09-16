# @sytadel/mcp-server

Model Context Protocol server that exposes Sytadel identity + access primitives as tools consumable from Claude Desktop, Cursor, and any MCP-aware client.

## What it is

**On its own:** a standalone MCP server you point at any running Sytadel control plane (`auth-api` + `zerotrust-api`). It turns identity/access operations into typed tools an LLM client can call — the tenant is always derived from the authenticated principal, never from a model-supplied argument.

**As part of Sytadel:** it is the agentic surface of the suite. It talks to `auth-api` (identity) through `zerotrust-api` (policy gateway), so every tool call is subject to the same per-tenant authorization as any other client. It is a *client* of the plane — it needs `auth-api` reachable to do anything. See the [suite architecture](../README.md).

Ships 5 tools out of the box:

| Tool | Description |
|------|-------------|
| `list_tenant_users` | Memberships of the current tenant with role, active flag, passkey count, last login |
| `list_service_accounts` | Client apps + their service accounts with idle days and rotation state |
| `query_session_anomalies` | Recent flagged logins (IP / country / device / score) |
| `generate_policy` | Compile natural-language RBAC intent → Sytadel PolicySet JSON |
| `run_access_review` | Trigger the AI-driven access review and return the full report |

## Installation

```bash
git clone https://github.com/ElwinErnst/sytadel-mcp-server
cd sytadel-mcp-server
npm install
npm run build
```

## Configuration

Auth has two modes — pick one depending on which tools you need:

### User mode (recommended for operators)

Full role scope. Every admin-level tool (list_tenant_users, list_service_accounts, run_access_review) works.

```bash
export SYTADEL_TENANT_SLUG=your-tenant
export SYTADEL_USER_EMAIL=you@example.com
export SYTADEL_USER_PASSWORD=your-password
```

### Service account mode

Restricted API_CLIENT scope. Read-only tools work (`query_session_anomalies`, `generate_policy`); admin tools return 403.

```bash
export SYTADEL_TENANT_SLUG=your-tenant
export SYTADEL_CLIENT_APP_ID=<uuid>
export SYTADEL_SERVICE_ACCOUNT_ID=<uuid>
export SYTADEL_SERVICE_ACCOUNT_SECRET=syt_...
```

### Endpoint URLs (optional overrides)

```bash
export SYTADEL_AUTH_API_URL=http://localhost:3002/api   # default
export SYTADEL_ZT_API_URL=http://localhost:3010          # default
export SYTADEL_TIMEOUT_MS=60000                          # default 60s
```

## Wiring into Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```jsonc
{
  "mcpServers": {
    "sytadel": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "SYTADEL_AUTH_API_URL": "http://localhost:3002/api",
        "SYTADEL_ZT_API_URL": "http://localhost:3010",
        "SYTADEL_TENANT_SLUG": "your-tenant",
        "SYTADEL_USER_EMAIL": "you@example.com",
        "SYTADEL_USER_PASSWORD": "your-password"
      }
    }
  }
}
```

Restart Claude Desktop. The 5 tools appear in the tool picker.

## Wiring into Cursor

Same shape, different path: `~/.cursor/mcp.json` (or via Settings → MCP → Add).

## Local sanity check

With the Sytadel stack running (`docker compose up -d` at the repo root):

```bash
npm run build
SYTADEL_TENANT_SLUG=sentinel-labs \
SYTADEL_USER_EMAIL=admin@test.com \
SYTADEL_USER_PASSWORD=123456 \
node dist/index.js
```

The server logs `starting stdio server: ... connected — awaiting MCP client` and waits for JSON-RPC on stdin.

## Design notes

- **No third-party HTTP library.** Everything uses native `fetch` + `AbortController`.
- **Token cache with 60s early refresh** and inflight-request coalescing so parallel tool calls share one auth handshake.
- **Logs to stderr only.** stdout is reserved for JSON-RPC framing; any `console.log` on stdout corrupts the protocol.

## License

Apache-2.0. See [LICENSE](./LICENSE).

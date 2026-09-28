# Sharing

Company-only link sharing with Google Workspace sign-in and an authenticated MCP endpoint. This checkout includes A1–A5 local flows. A4 uses Gemini for article summaries and YouTube Data API v3 for video metadata; processing is paused by default in `.env.example` until both keys are configured. Saved links have real queued jobs; automated tests use explicit fixtures.

## Local setup

Requirements: Node 24, pnpm 11.25.0, Docker.

```sh
pnpm install --frozen-lockfile
cp .env.example .env  # First setup only; do not overwrite existing credentials.
docker compose up -d --wait
pnpm db:migrate
pnpm admin:bootstrap tao.xu@authright.com
pnpm dev
```

Run the worker in another terminal:

```sh
pnpm dev:worker
```

Open **http://localhost:3000** (use `localhost` consistently for OAuth and cookies). PostgreSQL is bound to `127.0.0.1:55432`; the app database is `sharing`, the isolated test database is `sharing_test`. `docker compose stop` stops the database while preserving its volume.

Fill `.env` before starting:

- `BETTER_AUTH_SECRET` and `CURSOR_SIGNING_SECRET`: separate random values of at least 32 characters. Generate each with `openssl rand -hex 32`.
- `GOOGLE_WORKSPACE_DOMAIN=authright.com`.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: Google OAuth **Web application**, Internal audience. Origin `http://localhost:3000`; redirect `http://localhost:3000/api/auth/callback/google`. Only basic `openid email profile` identity permissions are requested.
- `APP_URL` / `BETTER_AUTH_URL`: `http://localhost:3000`. The application uses `APP_URL` as its canonical origin.
- `MCP_RESOURCE_URL=http://localhost:3000/mcp`.

Anyone signing in through Google with a verified `@authright.com` email can access Sharing. First sign-in automatically creates an ordinary member; no invitation, allowlist or approval is required. The bootstrap command assigns the initial administrator role only; it does not determine who may sign in. Legacy disabled flags no longer restrict access. `.env` is ignored; never copy it into the plugin distribution repository.

## Validation

```sh
pnpm check
pnpm test:integration
pnpm build
pnpm test:worker
pnpm exec playwright install chromium  # First browser-test setup only.
pnpm test:e2e
pnpm start:web
pnpm start:worker
```

Stop `pnpm dev` before starting the production web server on the same port. The integration entry point requires `/sharing_test`. Migration tests additionally create and clean up uniquely named `sharing_test_migration_<uuid>` databases; the test role needs CREATEDB permission. They run actual PostgreSQL transactions, pg-boss jobs, Better Auth OAuth registration/PKCE/consent/token exchange, and MCP requests. A test-only seeded identity replaces Google during automated tests; there is no application endpoint or request header that bypasses sign-in. Port 3101 is used for the isolated test issuer's real JWKS HTTP server.

Browser and real-client evidence is recorded in [compatibility and validation](docs/validation/COMPATIBILITY.md). Real Google sign-in and Codex OAuth plus actual `list_shares` / `get_share` calls passed. With the local service running and Codex authorized, `pnpm test:codex` repeats the installed Codex app-server check (set `SHARING_CODEX_BINARY` if needed). Claude Code and Cursor acceptance is deferred by agreement; automated integration tests do not replace those checks.

The Codex-only local B-stage implementation and installation evidence is in [B Codex local validation](docs/validation/B_CODEX_LOCAL.md). Use `SHARING_CODEX_PLUGIN=1 pnpm test:codex` to verify the installed local plugin connection and its read tools. In a new Codex chat, `$sharing:list-shares` explicitly invokes the listing Skill; four other focused Skills and the combined `$sharing:sharing` Skill are also installed. This does not publish a private marketplace or deploy an HTTPS service.

See the [S0/S1 audit](docs/validation/S0_S1_AUDIT.md) for item-by-item closure and remaining work. After the first-connection reset, the user reported no apparent issue with the desktop flow, but the independent CLI recheck still reported `notLoggedIn`; the saved successful tool-query evidence predates that reset. It is not a new post-reset pass. The query script also requires the retained sample link to fall within its default seven-day window.

A1 adds migration/constraint coverage, separate Web/Worker configuration, client import and credential checks, safe application logs and a CI workflow. `pnpm build` uses Webpack because this host blocks Turbopack’s CSS subprocess port. See the [A1 validation record](docs/validation/A1_FOUNDATION.md). Run `pnpm db:migrate` before starting code that uses the expanded schema.

A2–A5 implementation details, changed-file groups, tests and deferred external acceptance are recorded in [A2–A5 validation](docs/validation/A2_A5_PLATFORM.md). Browser tests use only `sharing_test` and port 3103, with desktop and mobile Chromium views. They seed test sessions through the auth adapter; they do not bypass sign-in in application code.

### Content processing configuration

`CONTENT_PROCESSING_ENABLED=false` is the template default. Set `GEMINI_API_KEY` and `YOUTUBE_API_KEY` in `.env`, then set processing to `true` and start the Worker. It consumes existing queued links as well as new submissions. Startup refuses to consume without both keys. Article summaries use Gemini 3.5 Flash-Lite, a single REST request per invocation, and an English JSON overview with 3–5 points. YouTube videos use the author's original Description; no model analyzes videos. The six-link live evaluation and saved shares are documented in [A4 validation](docs/validation/A4_REAL_SERVICES.md).

The default technical limits are two Worker jobs and one summary invocation at a time. Set `GEMINI_BILLING_TIER=free` when the Gemini API project is on its Free tier; successful known text usage then has zero estimated Gemini cost. Product monthly quotas are off by default. A6 provider RPM/TPM/RPD scheduling is deferred unless trials show frequent rate limits. The current Worker records a Gemini 429 as a processing failure, keeps the share, and allows a manual retry after capacity returns. No separate usage or audit page is planned. Queries never fetch an article or invoke a model.

## Current surface

- Web: Home submits links and shows the latest 5 shares. `/library` contains all historical shares, newest first, with search/filters and scrolling that loads 10 more at a time. Article/video detail, processing status, owned-share retry/withdrawal, account settings and member administration remain available.
- REST: share submission/list/detail, `DELETE /api/shares/:id`, `POST /api/shares/:id/retry`, `GET /api/members`, `PATCH /api/account`, administrator member list/role update, and `DELETE /api/grants/:id`. See [contracts](docs/validation/CONTRACTS.md).
- MCP: `POST /mcp`, `list_shares`, `get_share`, `list_members`, `share_link`, `withdraw_share`. Streamable HTTP, stateless 2025 compatibility and SDK 2026 protocol support.
- Discovery: `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server/api/auth`, auth/JWKS routes under `/api/auth`.
- Members appear in administration after first sign-in. Administrators manage roles, with protection against demoting the last company administrator. Manual member creation and disabling have been removed.

MCP connections request `shares:read` and optionally `offline_access`; user sessions and Google tokens are not accepted as MCP bearer tokens. Each request validates token signature, issuer, audience, expiry, scope, the user's verified company email, and connection status. Each OAuth authorization has its own connection; refresh tokens stay bound to that authorization instead of selecting the latest connection for a browser session.

### Reconnecting an agent

Revocation leaves the Sharing web session signed in. On the next MCP request, revoked credentials receive `401` with a standard OAuth challenge; an invalid refresh returns `invalid_grant`. The user verified that Codex displays a reconnect prompt and opens the Sharing authorization page after it is clicked. Review the permissions and choose **Allow access**, then retry the request. If no prompt appears, start authentication from the client's MCP connection settings. This observed Codex behavior is not a promise that every client opens a browser automatically.

Account shows revoked connections and reconnect instructions. Revocation clears remembered consent for that user/client so the next authorization asks again. A new authorization never reactivates old access or refresh tokens. Migration `0001` preserves existing connections and web sessions while removing already-revoked refresh chains and their remembered consent; run `pnpm db:migrate` before starting the updated app.

### First connection and account identity

Start authentication from the agent's Sharing connection prompt or MCP settings. If Sharing is not signed in in that browser, sign in with your `@authright.com` Google account, then review **Allow access**. If Sharing is already signed in, that account supplies the authorization identity. It does not have to match the email used to sign in to Codex.

Sharing stores the user's email, name, internal user ID and authorization records. The agent receives Sharing OAuth credentials; Google credentials and Gmail mailbox access are not part of this connection. Switching accounts on the website does not change an existing agent authorization. Revoke and authorize again under the intended Sharing account to switch the connection's identity.

For a deliberate first-connection test, see the scoped reset procedure in [DEVELOPMENT](docs/DEVELOPMENT.md#首次连接测试与重置范围). A normal reconnect does not require a reset or a Sharing sign-out.

## Next stages

See [development plan](docs/DEVELOPMENT_PLAN.md). The five MCP tools and local Codex Plugin packaging are in place. A6 quota enhancements are deferred; production operations belong to the deployment stage. HTTPS hosting and private repository creation remain deferred. Distribution remains **deployed services + a private plugin repository**; no public marketplace release is assumed.

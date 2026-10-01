# Sharing

Company-only link sharing with Google Workspace sign-in and an authenticated MCP endpoint. This checkout includes A1–A5 local flows. A4 uses Gemini for article summaries and YouTube Data API v3 for video metadata plus one non-streaming Gemini request using the public YouTube URL for video summaries; processing is paused by default in `.env.example` until both keys are configured. Saved links have real queued jobs; automated tests use explicit fixtures.

Configuration platforms and setup steps, including Google OAuth, Gemini, YouTube, production environment variables and client authorization, are collected in the [HTML configuration guide](docs/CONFIGURATION_GUIDE.html).

## Local setup

Requirements: Node 24, pnpm 11.25.0, Docker. The Worker uses the existing Gemini and YouTube API keys; no audio download tools or proxy are required.

```sh
pnpm install --frozen-lockfile
cp .env.example .env  # First setup only; do not overwrite existing credentials.
docker compose up -d --wait
pnpm db:migrate
pnpm admin:bootstrap tao.xu@authright.com
pnpm dev
```

After configuring the processing keys and billing tier, run the worker in another terminal. `pnpm dev` starts only the website; setting `CONTENT_PROCESSING_ENABLED=true` does not start a Worker process:

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

Browser and real-client evidence is recorded in [compatibility and validation](docs/validation/COMPATIBILITY.md). Real Google sign-in and Codex OAuth plus actual `list_shares` / `get_share` calls passed. With the local service running and Codex authorized, `pnpm test:codex` repeats the installed Codex app-server check (set `SHARING_CODEX_BINARY` if needed). Claude Code plugin installation has passed and the user reported normal operation. Cursor 0.4.0 packaging and installation checks passed; its OAuth registration fix is deployed, with actual browser login and tool calls still awaiting confirmation. Automated integration tests do not replace client checks.

The Cursor, Claude Code and Codex plugin source in `plugins/sharing/` is now version `0.4.0` and connects to `https://sharing.authright.com/mcp`; it does not require local Web, Worker or PostgreSQL processes. The package is uploaded to [Authright_Sharing_Plugin](https://github.com/TAO44123/Authright_Sharing_Plugin), with the team marketplace name `authright-sharing`; see [remote plugin installation and verification](docs/PLUGIN_REMOTE.md). This application's development marketplace retains the name `sharing-local`, which describes where the package is installed from, not the service endpoint. Existing installed copies need to be updated and authorized for the production URL. Earlier local installation evidence remains in [B Codex local validation](docs/validation/B_CODEX_LOCAL.md). On 2026-09-30, this Codex desktop chat successfully queried the production seven-day share list (5 records, no remaining cursor). This confirms that query through the installed 0.4.0 connection; Git-source installation, write operations, refresh and revocation remain separate checks.

See the [S0/S1 audit](docs/validation/S0_S1_AUDIT.md) for historical item-by-item closure. Its post-reset CLI `notLoggedIn` result remains historical; the later production desktop query is recorded in [B Codex validation](docs/validation/B_CODEX_LOCAL.md). The query script requires its retained sample link to fall within the default seven-day window.

A1 adds migration/constraint coverage, separate Web/Worker configuration, client import and credential checks, safe application logs and a CI workflow. `pnpm build` uses Webpack because this host blocks Turbopack’s CSS subprocess port. See the [A1 validation record](docs/validation/A1_FOUNDATION.md). Run `pnpm db:migrate` before starting code that uses the expanded schema.

A2–A5 implementation details, changed-file groups, tests and deferred external acceptance are recorded in [A2–A5 validation](docs/validation/A2_A5_PLATFORM.md). Browser tests use only `sharing_test` and port 3103, with desktop and mobile Chromium views. They seed test sessions through the auth adapter; they do not bypass sign-in in application code.

### Content processing configuration

Current implementation (2026-09-29): YouTube videos use one non-streaming Gemini request with a canonical URL, 600-second request timeout and 0.1 fps for videos at least 30 minutes long or with unknown duration. Migration `0004_slow_menace` is applied locally and in production and adds nullable cache usage fields; old audio summaries and two-call records remain intact. The UI now distinguishes queued from generating. See the [Worker setup](docs/YOUTUBE_AUDIO_WORKER.md) and [current validation](docs/validation/YOUTUBE_URL_GEMINI.md).

The implementation is committed and pushed to GitHub `main` as [f9cd079](https://github.com/TAO44123/Authright_Sharing/commit/f9cd079eb22cc2cedd15c67fb33dafdf10a5c02c). Lightsail pulled the subsequent documentation commit `6581554`, built and deployed `sharing:6581554` for both Web and Worker, and applied `0004`. The actual compiled Worker claimed two pg-boss jobs in a disposable server database and completed both a short video and the 110-minute video, with one model invocation and one quota unit each. The test database was removed and the two existing production shares were preserved.

Latest deployment record (2026-09-30): Web runs `sharing:5b97020` with the Cursor OAuth registration compatibility patch; Worker continues on `sharing:6581554`. No additional migration was needed. Loopback registrations returned 201 and authorization reached the production sign-in page; the real Cursor flow still needs confirmation. See [deployment](docs/DEPLOY_LIGHTSAIL.md), [patch scope](patches/README.md) and [Cursor validation](docs/validation/B_CURSOR_PLUGIN.md).

The active Worker configuration, environment templates, Dockerfile and Compose no longer use yt-dlp, EJS, FFmpeg or a YouTube download proxy. Legacy audio modules/tests, `.local/audio-tools`, and the old tool paths in this machine's ignored `.env` remain; the new Worker does not use them. The deployed image excludes the old audio tool installation; previous images remain available for rollback. See the [cleanup scope](docs/YOUTUBE_AUDIO_WORKER.md#旧配置的移除范围).

`CONTENT_PROCESSING_ENABLED=false` is the template default. Configure both API keys and billing tier, then enable processing and start the Worker. Startup consumes existing queued links. Article summaries use one Gemini REST request with an English overview and 3–5 points. YouTube summaries use the actual supplied URL in one non-streaming request, combining speech and sampled visuals; title and Description are not summary inputs. The original Description is returned separately. No media or full transcripts are stored. Completed summaries are reused; metadata refresh does not invoke a model. See the [video Worker](docs/YOUTUBE_AUDIO_WORKER.md). Earlier article/metadata and audio evaluations remain in the validation directory as historical evidence.

The default technical limits are two Worker jobs and one summary invocation at a time. Set `GEMINI_BILLING_TIER=free` when the Gemini API project is on its Free tier; successful known text/video usage then has zero estimated Gemini cost. Product monthly quotas are off by default. Articles and videos each reserve one model call. Historical two-call audio records remain unchanged. Metadata-only refreshes do not invoke Gemini. A6 provider RPM/TPM/RPD scheduling is deferred unless trials show frequent rate limits. The current Worker records a Gemini 429 as a processing failure, keeps the share, and allows a manual retry after capacity returns. No separate usage or audit page is planned. Queries never fetch an article or invoke a model.

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

See the [Lightsail deployment runbook](docs/DEPLOY_LIGHTSAIL.md) for Docker Compose, Caddy HTTPS, migrations, backups and updates. Production at [sharing.authright.com](https://sharing.authright.com) now runs the URL Worker image `sharing:6581554`; health, Worker heartbeats and server queue acceptance passed. The migration backup was checked and copied off the host. Daily automated backups, a production restore rehearsal and private plugin distribution remain separate follow-up work.

See [development plan](docs/DEVELOPMENT_PLAN.md). The five MCP tools and shared Claude Code/Codex Plugin packaging are in place. A6 quota enhancements are deferred. Claude Code 0.3.0 Git-source installation and component loading passed; see [validation](docs/validation/B_CLAUDE_PLUGIN.md). Production OAuth/tool calls and team-access/update acceptance remain pending. Distribution remains **deployed services + a private plugin repository**; no public marketplace release is assumed.

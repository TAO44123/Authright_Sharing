# OAuth Provider 1.7.6: Cursor desktop registration compatibility

Cursor registers combinations of these callbacks with `token_endpoint_auth_method: none`
and omits `application_type`:

- `cursor://anysphere.cursor-mcp/oauth/callback`
- `https://www.cursor.com/agents/mcp/oauth/callback`
- `http://localhost:8787/callback`
- `http://127.0.0.1:8787/callback`

OAuth Provider 1.7.6 defaults to `web`, rejecting both the legacy scheme and HTTP loopback URIs before Cursor can
open a browser. Desktop loopback mode registers the HTTPS callback and localhost
without the legacy scheme; IPv4 mode can add the exact 127.0.0.1 callback. Simply declaring `native` also fails because its validator
requires reverse-domain private-use schemes without a naming authority.

The version-pinned pnpm patch makes two bounded compatibility exceptions:

1. Infer `native` only when application_type is omitted, client authentication is
   `none`, at least one exact legacy or loopback callback is present, and every
   redirect is one of the four callbacks above. HTTPS-only clients remain web. Explicit `web`, confidential clients, and mixed lists
   retain the original defaults and validation.
2. Permit exactly the legacy callback for native registration. Similar hosts,
   other paths, query parameters, fragments and userinfo receive no exception.

Client metadata is self-asserted, not identity verification. PKCE, consent,
company membership, scope validation, exact registered redirect matching and
token/refresh/grant validation remain in the provider and application. The
exception does not skip any of these checks.

The patch is applied by `pnpm install --frozen-lockfile`. The production Dockerfile
copies patches before dependency installation. Do not edit node_modules manually.
When upgrading the provider, review upstream support and remove this patch once
the compatibility test passes without it; do not blindly rebase it onto a new
validation implementation.

Validation: `pnpm exec vitest run tests/integration/core.test.ts -t 'real OAuth and HTTP boundaries' --fileParallelism=false`.
The Cursor integration cases cover legacy, desktop loopback, IPv4 and standalone
loopback callback sets, wrong/mixed callback sets,
forbidden schemes, explicit web/confidential clients, invalid scopes, required
PKCE, user consent and unregistered redirect rejection. Existing OAuth tests
exercise code exchange, MCP calls, refresh and revoked grants.

The full core suite also exposed an existing video summary assertion that still
expects audio-only coverage for a current-format fixture. It is unrelated to
OAuth and is not counted as a passing test.

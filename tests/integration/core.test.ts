import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID, createHmac, createHash } from "node:crypto";
import { createServer } from "node:http";
import { decodeJwt } from "jose";
import {
  Client,
  StreamableHTTPClientTransport,
  type OAuthClientProvider,
} from "@modelcontextprotocol/client";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../../src/server/db/index.ts";
import { user } from "../../src/server/db/auth-schema.ts";
import {
  agentGrants,
  contents,
  members,
  shares,
  tasks,
} from "../../src/server/db/schema.ts";
import { createBoss, getBoss, CONTENT_QUEUE } from "../../src/server/queue.ts";
import { shareLink, listShares, getShare } from "../../src/server/shares.ts";
import {
  authorize,
  bindMembership,
  issueGrant,
  revokeGrant,
  type Actor,
} from "../../src/server/membership.ts";
import { config } from "../../src/server/config.ts";

const suffix = randomUUID();
const uid = `test-${suffix}`;
const uid2 = `test-other-${suffix}`;
const actor: Actor = { userId: uid, transport: "web", scopes: [] };
const other: Actor = { userId: uid2, transport: "web", scopes: [] };
let auth: typeof import("../../src/server/auth.ts").auth;
let cookie: string;
const jwksServer = createServer(async (req, res) => {
  // Real HTTP against the isolated test issuer and MCP server, never the dev app.
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const request = new Request(`${config.APP_URL}${req.url}`, {
    method: req.method,
    headers: Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [
        k,
        Array.isArray(v) ? v.join(", ") : (v ?? ""),
      ]),
    ),
    ...(chunks.length ? { body: Buffer.concat(chunks).toString() } : {}),
  });
  const result =
    req.url === "/mcp"
      ? await (await import("../../src/server/mcp.ts")).mcpHandler(request)
      : await auth.handler(request);
  res.writeHead(result.status, Object.fromEntries(result.headers));
  res.end(await result.text());
});
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  const boss = createBoss(true);
  await boss.start();
  await boss.createQueue(CONTENT_QUEUE);
  await boss.stop();
  for (const id of [uid, uid2]) {
    await db.insert(user).values({
      id,
      name: "Test Member",
      email: `${id}@authright.com`,
      emailVerified: true,
    });
    await bindMembership(id);
  }
  auth = (await import("../../src/server/auth.ts")).auth;
  await new Promise<void>((resolve) =>
    jwksServer.listen(3101, "127.0.0.1", resolve),
  );
  const ctx = await auth.$context;
  const session = await ctx.internalAdapter.createSession(uid);
  const signature = createHmac("sha256", config.BETTER_AUTH_SECRET)
    .update(session.token)
    .digest("base64");
  cookie = `better-auth.session_token=${encodeURIComponent(`${session.token}.${signature}`)}`;
});
afterAll(async () => {
  jwksServer.closeAllConnections();
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  await (await getBoss()).stop();
  await pool.end();
});

describe("database sharing invariants", () => {
  it("concurrent retries create one share, content, task and transactional pg-boss job", async () => {
    const url = `https://example.com/${suffix}/concurrent`;
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        shareLink(actor, { url, idempotency_key: "same-retry-key" }),
      ),
    );
    expect(new Set(results.map((r) => r.share.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    const contentId = results[0].share.content_id;
    expect(
      await db.select().from(tasks).where(eq(tasks.contentId, contentId)),
    ).toHaveLength(1);
    const jobs = await db.execute(
      sql`select id from pgboss.job where data->>'contentId' = ${contentId}`,
    );
    expect(jobs.rows).toHaveLength(1);
    await expect(
      shareLink(actor, {
        url: `${url}?different=1`,
        idempotency_key: "same-retry-key",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const second = await shareLink(other, {
      url,
      idempotency_key: "same-retry-key",
    });
    expect(second.share.content_id).toBe(contentId);
    expect(second.share.id).not.toBe(results[0].share.id);
    expect(
      await db.select().from(tasks).where(eq(tasks.contentId, contentId)),
    ).toHaveLength(1);
  });
  it("rolls back the content, share and actual queued job when task persistence fails", async () => {
    const url = `https://example.com/${suffix}/rollback`;
    const before = (
      await db.execute(sql`select count(*)::int n from pgboss.job`)
    ).rows[0].n;
    await db.execute(
      sql`create or replace function reject_test_task() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$`,
    );
    await db.execute(
      sql`create trigger test_reject before insert on content_tasks for each row execute function reject_test_task()`,
    );
    try {
      await expect(
        shareLink(actor, { url, idempotency_key: "rollback-test" }),
      ).rejects.toThrow();
    } finally {
      await db.execute(sql`drop trigger test_reject on content_tasks`);
      await db.execute(sql`drop function reject_test_task()`);
    }
    expect(
      await db.select().from(contents).where(eq(contents.originalUrl, url)),
    ).toHaveLength(0);
    expect(
      await db.select().from(shares).where(eq(shares.originalUrl, url)),
    ).toHaveLength(0);
    expect(
      (await db.execute(sql`select count(*)::int n from pgboss.job`)).rows[0].n,
    ).toBe(before);
  });
  it("freezes pagination, handles tied timestamps and rejects tampered cursors", async () => {
    const ids: string[] = [];
    for (let n = 0; n < 3; n++)
      ids.push(
        (
          await shareLink(actor, {
            url: `https://example.com/${suffix}/paging/${n}`,
            idempotency_key: `paging-key-${n}`,
          })
        ).share.id,
      );
    for (const id of ids)
      await db
        .update(shares)
        .set({ createdAt: new Date("2026-09-20T12:00:00Z") })
        .where(eq(shares.id, id));
    const first = await listShares(actor, {
      from: "2026-09-20T00:00:00Z",
      to: "2026-09-21T00:00:00Z",
      keyword: suffix,
      limit: 2,
    });
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).toBeTruthy();
    const second = await listShares(actor, { cursor: first.next_cursor });
    expect(second.items).toHaveLength(1);
    expect(
      new Set([...first.items, ...second.items].map((s) => s.id)).size,
    ).toBe(3);
    expect(second.to).toBe(first.to);
    await expect(
      listShares(actor, { cursor: first.next_cursor + "a" }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(
      listShares(other, { cursor: first.next_cursor }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });
  it("revokes a single connection without affecting a different client", async () => {
    const g1 = await issueGrant(
      uid,
      "client-a",
      "session-a",
      `code-a-${suffix}`,
      true,
    );
    const g2 = await issueGrant(
      uid,
      "client-b",
      "session-a",
      `code-b-${suffix}`,
      true,
    );
    const a: Actor = {
      userId: uid,
      transport: "mcp",
      clientId: "client-a",
      grantId: g1,
      scopes: ["shares:read"],
    };
    const b: Actor = { ...a, clientId: "client-b", grantId: g2 };
    await authorize(a, "shares:read");
    await revokeGrant(actor, g1);
    await expect(authorize(a, "shares:read")).rejects.toMatchObject({
      code: "GRANT_REVOKED",
    });
    await authorize(b, "shares:read");
    await expect(
      issueGrant(uid, "client-a", "session-a", `code-a-${suffix}`, false),
    ).rejects.toMatchObject({ code: "GRANT_REVOKED" });
    await expect(
      authorize({ ...b, scopes: [] }, "shares:read"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("keeps legacy refreshes bound to legacy grants across same-session reconnects", async () => {
    const clientId = `legacy-${suffix}`;
    const [legacy] = await db
      .insert(agentGrants)
      .values({
        userId: uid,
        clientId,
        sessionId: "legacy-session",
      })
      .returning();
    expect(
      await issueGrant(uid, clientId, "legacy-session", "legacy-code", false),
    ).toBe(legacy.id);
    await revokeGrant(actor, legacy.id);
    const ids = await Promise.all(
      Array.from({ length: 4 }, () =>
        issueGrant(uid, clientId, "legacy-session", `new-code-${suffix}`, true),
      ),
    );
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).not.toBe(legacy.id);
    await expect(
      issueGrant(uid, clientId, "legacy-session", "legacy-code", false),
    ).rejects.toMatchObject({ code: "GRANT_REVOKED", status: 401 });
    expect(
      await issueGrant(
        uid,
        clientId,
        "legacy-session",
        `new-code-${suffix}`,
        false,
      ),
    ).toBe(ids[0]);
    await expect(
      issueGrant(
        uid,
        "other-client",
        "legacy-session",
        `new-code-${suffix}`,
        false,
      ),
    ).rejects.toMatchObject({ code: "GRANT_REVOKED" });
  });
  it("creates first-login membership without an allowlist and ignores legacy disabled status", async () => {
    await expect(bindMembership("unlisted-user")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await db
      .update(members)
      .set({ status: "disabled" })
      .where(eq(members.userId, uid2));
    await expect(listShares(other)).resolves.toHaveProperty("items");
    await bindMembership(uid2);
    const context = await auth.$context;
    const first = await context.internalAdapter.createUser(
      {
        name: "First company login",
        email: `first-${suffix}@authright.com`,
        emailVerified: true,
      },
      { method: "oauth", oauth: { providerId: "google" } },
    );
    expect(
      await db.select().from(members).where(eq(members.userId, first.id)),
    ).toHaveLength(0);
    await context.internalAdapter.createSession(first.id);
    expect(
      (await db.select().from(members).where(eq(members.userId, first.id)))[0],
    ).toMatchObject({ role: "member", status: "active" });
    for (const identity of [
      { email: `outsider-${suffix}@example.com`, emailVerified: true },
      { email: `unverified-${suffix}@authright.com`, emailVerified: false },
    ])
      await expect(
        context.internalAdapter.createUser(
          { name: "Rejected", ...identity },
          { method: "oauth", oauth: { providerId: "google" } },
        ),
      ).rejects.toThrow();
  });
});

describe("real OAuth and HTTP boundaries with test-only seeded identity", () => {
  it("recognizes a signed session and rejects missing sessions and cross-origin writes", async () => {
    const { GET, POST } = await import("../../src/app/api/shares/route.ts");
    const request = new Request("http://localhost:3000/api/shares", {
      headers: { cookie },
    });
    expect((await GET(request)).status).toBe(200);
    expect((await GET(new Request(request.url))).status).toBe(401);
    expect(
      (
        await POST(
          new Request(request.url, {
            method: "POST",
            headers: { cookie, origin: "https://evil.example" },
          }),
        )
      ).status,
    ).toBe(403);
  });
  it("uses discovery, DCR, PKCE and consent to query a web-created record over MCP; revoked JWTs fail immediately", async () => {
    const { POST } = await import("../../src/app/api/shares/route.ts");
    const web = await POST(
      new Request("http://localhost:3000/api/shares", {
        method: "POST",
        headers: {
          cookie,
          origin: config.APP_URL,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          url: `https://example.com/${suffix}/oauth`,
          idempotency_key: "oauth-web-share",
        }),
      }),
    );
    expect(web.status).toBe(201);
    const saved = await web.json();
    const call = (path: string, init?: RequestInit) =>
      auth.handler(new Request(`${config.APP_URL}${path}`, init));
    const discovery = await call(
      "/.well-known/oauth-authorization-server/api/auth",
    );
    expect(discovery.status).toBe(200);
    const metadata = await discovery.json();
    expect(metadata.code_challenge_methods_supported).toContain("S256");
    const registration = await call("/api/auth/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "S1 integration client",
        application_type: "native",
        redirect_uris: ["http://127.0.0.1:39999/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "openid offline_access shares:read shares:write members:read",
      }),
    });
    expect(
      registration.status,
      registration.status === 201 ? "" : await registration.clone().text(),
    ).toBe(201);
    const client = await registration.json();
    const verifier = randomUUID() + randomUUID();
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const query = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: "http://127.0.0.1:39999/callback",
      response_type: "code",
      scope: "openid offline_access shares:read shares:write members:read",
      state: randomUUID(),
      resource: config.MCP_RESOURCE_URL,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const authorization = await call(`/api/auth/oauth2/authorize?${query}`, {
      headers: { cookie },
    });
    expect(authorization.status).toBe(302);
    const consentUrl = new URL(
      authorization.headers.get("location")!,
      config.APP_URL,
    );
    expect(consentUrl.pathname).toBe("/consent");
    const modifiedQuery = new URLSearchParams(consentUrl.search);
    modifiedQuery.set("scope", "not-a-valid-scope");
    const tampered = await call("/api/auth/oauth2/consent", {
      method: "POST",
      headers: {
        cookie,
        origin: config.APP_URL,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        accept: true,
        oauth_query: modifiedQuery.toString(),
      }),
    });
    expect(tampered.ok).toBe(false);
    const consent = await call("/api/auth/oauth2/consent", {
      method: "POST",
      headers: {
        cookie,
        origin: config.APP_URL,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        accept: true,
        oauth_query: consentUrl.search.slice(1),
      }),
    });
    expect(consent.status).toBe(200);
    const consentData = await consent.json();
    const code = new URL(consentData.url).searchParams.get("code")!;
    const tokenRequest = (extra: Record<string, string>) =>
      call("/api/auth/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: client.client_id,
          resource: config.MCP_RESOURCE_URL,
          ...extra,
        }),
      });
    const tokens = await tokenRequest({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: "http://127.0.0.1:39999/callback",
    });
    expect(tokens.status).toBe(200);
    const token = await tokens.json();
    expect(token.access_token).toBeTruthy();
    const [recordedGrant] = await db
      .select({ scopes: agentGrants.scopes })
      .from(agentGrants)
      .where(
        eq(
          agentGrants.id,
          decodeJwt(token.access_token).sharing_grant as string,
        ),
      );
    expect(recordedGrant.scopes).toEqual([
      "shares:read",
      "shares:write",
      "members:read",
    ]);
    const { mcpHandler } = await import("../../src/server/mcp.ts");
    const request = (
      bearer: string,
      name = "get_share",
      args: Record<string, unknown> = { share_id: saved.share.id },
    ) =>
      new Request(config.MCP_RESOURCE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-11-25",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name,
            arguments: args,
          },
        }),
      });
    const response = await mcpHandler(request(token.access_token));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(saved.share.id);
    for (const mode of ["legacy", { pin: "2026-07-28" }] as const) {
      const sdk = new Client(
        { name: "sharing-s1-test", version: "0.1.0" },
        { versionNegotiation: { mode } },
      );
      try {
        await sdk.connect(
          new StreamableHTTPClientTransport(new URL(config.MCP_RESOURCE_URL), {
            requestInit: {
              headers: { Authorization: `Bearer ${token.access_token}` },
            },
          }),
        );
        expect((await sdk.listTools()).tools.map((t) => t.name)).toEqual([
          "list_shares",
          "get_share",
          "share_link",
          "list_members",
          "withdraw_share",
        ]);
        const result = await sdk.callTool({
          name: "list_shares",
          arguments: { keyword: suffix },
        });
        expect(JSON.stringify(result)).toContain(saved.share.id);
        if (mode === "legacy") {
          const memberResult = await sdk.callTool({
            name: "list_members",
            arguments: { query: uid },
          });
          expect(JSON.stringify(memberResult)).toContain(uid);
          const newUrl = `https://example.com/${suffix}/mcp-write`;
          const writeInput = {
            url: newUrl,
            idempotency_key: "mcp-integration-share",
          };
          const written = await sdk.callTool({
            name: "share_link",
            arguments: writeInput,
          });
          expect(written.isError).not.toBe(true);
          const first = written.structuredContent as {
            share: { share_id: string; original_url: string };
            replayed: boolean;
          };
          expect(first.share.original_url).toBe(newUrl);
          expect(first.replayed).toBe(false);
          const replay = await sdk.callTool({
            name: "share_link",
            arguments: writeInput,
          });
          expect(
            (replay.structuredContent as { replayed: boolean }).replayed,
          ).toBe(true);
          const withdrawn = await sdk.callTool({
            name: "withdraw_share",
            arguments: { share_id: first.share.share_id },
          });
          expect(withdrawn.structuredContent).toEqual({
            share_id: first.share.share_id,
            withdrawn: true,
          });
          const hidden = await sdk.callTool({
            name: "get_share",
            arguments: { share_id: first.share.share_id },
          });
          expect(hidden.isError).toBe(true);
        }
      } finally {
        await sdk.close();
      }
    }
    const invalidResponse = await mcpHandler(request("invalid"));
    expect(invalidResponse.status).toBe(401);
    expect(invalidResponse.headers.get("www-authenticate")).toContain(
      "resource_metadata=",
    );
    const anonymous = request("");
    anonymous.headers.delete("authorization");
    const anonymousResponse = await mcpHandler(anonymous);
    expect(anonymousResponse.status).toBe(401);
    expect(anonymousResponse.headers.get("www-authenticate")).toContain(
      "resource_metadata=",
    );
    expect(anonymousResponse.headers.get("www-authenticate")).toContain(
      'scope="shares:read shares:write members:read"',
    );
    for (const change of [
      { aud: "https://wrong.example/mcp" },
      { exp: 1 },
      { iss: "https://wrong.example/auth" },
    ]) {
      const invalid = await auth.api.signJWT({
        body: { payload: { ...decodeJwt(token.access_token), ...change } },
      });
      expect((await mcpHandler(request(invalid.token))).status).toBe(401);
    }
    const noScope = await auth.api.signJWT({
      body: { payload: { ...decodeJwt(token.access_token), scope: "openid" } },
    });
    expect((await mcpHandler(request(noScope.token))).status).toBe(403);
    const readOnly = await auth.api.signJWT({
      body: {
        payload: { ...decodeJwt(token.access_token), scope: "shares:read" },
      },
    });
    const forbiddenWrite = await mcpHandler(
      request(readOnly.token, "share_link", {
        url: `https://example.com/${suffix}/forbidden-write`,
        idempotency_key: "forbidden-mcp-write",
      }),
    );
    expect(forbiddenWrite.status).toBe(403);
    expect(forbiddenWrite.headers.get("www-authenticate")).toContain(
      'scope="shares:read shares:write"',
    );
    const forbiddenMembers = await mcpHandler(
      request(readOnly.token, "list_members", { query: uid }),
    );
    expect(forbiddenMembers.status).toBe(403);
    expect(forbiddenMembers.headers.get("www-authenticate")).toContain(
      'scope="shares:read members:read"',
    );
    await db
      .update(user)
      .set({ email: `${uid}@outside.example` })
      .where(eq(user.id, uid));
    expect((await mcpHandler(request(token.access_token))).status).toBe(403);
    const { GET } = await import("../../src/app/api/shares/route.ts");
    expect(
      (
        await GET(
          new Request(`${config.APP_URL}/api/shares`, { headers: { cookie } }),
        )
      ).status,
    ).toBe(403);
    await db
      .update(user)
      .set({ email: `${uid}@authright.com` })
      .where(eq(user.id, uid));
    const refreshed = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    });
    expect(refreshed.status).toBe(200);
    const fresh = await refreshed.json();
    expect((await mcpHandler(request(fresh.access_token))).status).toBe(200);
    const [grant] = await db
      .select()
      .from(agentGrants)
      .where(eq(agentGrants.clientId, client.client_id));
    await revokeGrant(actor, grant.id);
    const revoked = await mcpHandler(request(fresh.access_token));
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get("www-authenticate")).toContain(
      'error="invalid_token"',
    );
    expect(revoked.headers.get("www-authenticate")).toContain(
      `resource_metadata="${config.APP_URL}/.well-known/oauth-protected-resource/mcp"`,
    );
    expect(revoked.headers.get("cache-control")).toBe("no-store");
    expect((await mcpHandler(request(token.access_token))).status).toBe(401);
    const rejectedRefresh = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: fresh.refresh_token,
    });
    expect(rejectedRefresh.status).toBe(400);
    expect((await rejectedRefresh.json()).error).toBe("invalid_grant");

    // Reconnect with the SAME client and the SAME browser session. Clearing
    // remembered consent on revoke must show Allow access without prompt=consent.
    expect(
      (
        await GET(
          new Request(`${config.APP_URL}/api/shares`, { headers: { cookie } }),
        )
      ).status,
    ).toBe(200);
    query.set("state", randomUUID());
    const reconnect = await call(`/api/auth/oauth2/authorize?${query}`, {
      headers: { cookie },
    });
    expect(reconnect.status).toBe(302);
    const reconnectUrl = new URL(
      reconnect.headers.get("location")!,
      config.APP_URL,
    );
    expect(reconnectUrl.pathname).toBe("/consent");
    const respondToConsent = (accept: boolean) =>
      call("/api/auth/oauth2/consent", {
        method: "POST",
        headers: {
          cookie,
          origin: config.APP_URL,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          accept,
          oauth_query: reconnectUrl.search.slice(1),
        }),
      });
    const denied = await respondToConsent(false);
    expect(new URL((await denied.json()).url).searchParams.get("error")).toBe(
      "access_denied",
    );
    expect((await mcpHandler(request(fresh.access_token))).status).toBe(401);
    const accepted = await respondToConsent(true);
    expect(accepted.status).toBe(200);
    const newCode = new URL((await accepted.json()).url).searchParams.get(
      "code",
    )!;
    const reconnectedResponse = await tokenRequest({
      grant_type: "authorization_code",
      code: newCode,
      code_verifier: verifier,
      redirect_uri: "http://127.0.0.1:39999/callback",
    });
    expect(reconnectedResponse.status).toBe(200);
    const reconnected = await reconnectedResponse.json();
    const newGrantId = decodeJwt(reconnected.access_token).sharing_grant;
    expect(newGrantId).not.toBe(grant.id);
    expect((await mcpHandler(request(reconnected.access_token))).status).toBe(
      200,
    );

    // Neither old access tokens nor ANY old refresh generation can recover or
    // invalidate the new connection after reauthorization.
    for (const old of [token, fresh]) {
      expect((await mcpHandler(request(old.access_token))).status).toBe(401);
      const result = await tokenRequest({
        grant_type: "refresh_token",
        refresh_token: old.refresh_token,
      });
      expect(result.status).toBe(400);
      expect((await result.json()).error).toBe("invalid_grant");
    }
    const newRefreshResponse = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: reconnected.refresh_token,
    });
    expect(newRefreshResponse.status).toBe(200);
    const newRefresh = await newRefreshResponse.json();
    expect(decodeJwt(newRefresh.access_token).sharing_grant).toBe(newGrantId);
    expect((await mcpHandler(request(newRefresh.access_token))).status).toBe(
      200,
    );
    const [oldGrant] = await db
      .select()
      .from(agentGrants)
      .where(eq(agentGrants.id, grant.id));
    expect(oldGrant.revokedAt).not.toBeNull();
    // Retrying a revoke for the old record must not remove the new
    // authorization's refresh chain, even for the same client and web session.
    await revokeGrant(actor, grant.id);
    const stillConnected = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: newRefresh.refresh_token,
    });
    expect(stillConnected.status).toBe(200);
    expect(
      decodeJwt((await stillConnected.json()).access_token).sharing_grant,
    ).toBe(newGrantId);

    // Exercise the official SDK's automatic recovery: revoked request ->
    // invalid refresh -> discard credentials -> start OAuth with fresh PKCE.
    let sdkTokens: ReturnType<OAuthClientProvider["tokens"]> = fresh;
    let sdkVerifier = "";
    let authorizationUrl: URL | undefined;
    const provider: OAuthClientProvider = {
      redirectUrl: "http://127.0.0.1:39999/callback",
      clientMetadata: {
        redirect_uris: ["http://127.0.0.1:39999/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "offline_access shares:read",
      },
      clientInformation: () => client,
      tokens: () => sdkTokens,
      saveTokens: (value) => {
        sdkTokens = value;
      },
      saveCodeVerifier: (value) => {
        sdkVerifier = value;
      },
      codeVerifier: () => sdkVerifier,
      redirectToAuthorization: (url) => {
        authorizationUrl = url;
      },
      invalidateCredentials: (scope) => {
        if (scope === "tokens" || scope === "all") sdkTokens = undefined;
      },
    };
    const autoClient = new Client({ name: "reconnect-test", version: "1.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(config.MCP_RESOURCE_URL),
      { authProvider: provider },
    );
    try {
      await expect(autoClient.connect(transport)).rejects.toThrow();
      expect(authorizationUrl).toBeDefined();
      expect(authorizationUrl!.pathname).toBe("/api/auth/oauth2/authorize");
      expect(authorizationUrl!.searchParams.get("code_challenge_method")).toBe(
        "S256",
      );
      expect(authorizationUrl!.searchParams.get("resource")).toBe(
        config.MCP_RESOURCE_URL,
      );
      expect(sdkTokens).toBeUndefined();
    } finally {
      await autoClient.close();
    }
  });
});

it("A3 keeps independent shares, safe DTOs, literal search, ownership and retry idempotency", async () => {
  await db
    .update(members)
    .set({ status: "active" })
    .where(eq(members.userId, uid));
  await db
    .update(members)
    .set({ status: "active" })
    .where(eq(members.userId, uid2));
  const { withdrawShare, retryShare } =
    await import("../../src/server/shares.ts");
  const { listMembers } = await import("../../src/server/member-search.ts");
  const url = `https://example.com/${suffix}/a3`;
  const first = await shareLink(actor, { url, idempotency_key: "a3-first" });
  const second = await shareLink(other, { url, idempotency_key: "a3-second" });
  await expect(withdrawShare(other, first.share.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await withdrawShare(actor, first.share.id);
  await withdrawShare(actor, first.share.id);
  await expect(getShare(actor, first.share.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect((await getShare(actor, second.share.id)).share_id).toBe(
    second.share.id,
  );
  expect(
    (await shareLink(actor, { url, idempotency_key: "a3-first" })).share
      .withdrawn,
  ).toBe(true);
  await db
    .update(tasks)
    .set({ state: "failed" })
    .where(eq(tasks.contentId, second.share.content_id));
  await db
    .update(contents)
    .set({ status: "failed", failureCode: "FETCH_FAILED" })
    .where(eq(contents.id, second.share.content_id));
  await expect(
    retryShare(actor, second.share.id, { idempotency_key: "other-retry" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const retries = await Promise.all(
    [0, 1].map(() =>
      retryShare(other, second.share.id, { idempotency_key: "same-retry-a3" }),
    ),
  );
  expect(retries.filter((r) => r.replayed)).toHaveLength(1);
  expect(retries[0].share.status).toBe("queued");
  await db
    .update(contents)
    .set({
      status: "ready",
      summaryOverview: `A3 literal_%_${suffix}`,
      summaryKeyPoints: ["One", "Two", "Three"],
    })
    .where(eq(contents.id, second.share.content_id));
  const result = await listShares(actor, {
    query: `literal_%_${suffix}`,
    sharer_id: uid2,
  });
  expect(result.items).toHaveLength(1);
  expect(result.items[0].source).toBe("ai_article_summary");
  expect(result.items[0].article_summary).toBeNull();
  expect(
    (await getShare(actor, second.share.id)).article_summary?.key_points,
  ).toHaveLength(3);
  const names = await listMembers(actor, { query: "Test Member", limit: 1 });
  expect(names.members).toHaveLength(1);
  expect(names.next_cursor).toBeTruthy();
  const next = await listMembers(actor, { cursor: names.next_cursor });
  expect(next.members[0].id).not.toBe(names.members[0].id);
  const video = await shareLink(actor, {
    url: "https://youtu.be/dQw4w9WgXcQ",
    idempotency_key: `video-${suffix}`,
  });
  await db
    .update(contents)
    .set({
      status: "ready",
      videoDescription: "",
      metadataFetchedAt: new Date(),
      metadataExpiresAt: new Date(Date.now() + 86400000),
    })
    .where(eq(contents.id, video.share.content_id));
  const emptyDescription = await getShare(actor, video.share.id);
  expect(emptyDescription.source).toBe("youtube_description");
  expect(emptyDescription.video_description).toBe("");
  await db
    .update(contents)
    .set({
      status: "ready",
      title: "Expired title",
      videoDescription: "Expired description",
      metadataFetchedAt: new Date("2026-01-01"),
      metadataExpiresAt: new Date("2026-02-01"),
    })
    .where(eq(contents.id, video.share.content_id));
  const expired = await getShare(actor, video.share.id);
  expect(expired.source).toBe("none");
  expect(expired.title).toBeNull();
  expect(expired.video_description).toBeNull();
});

it("uses the email local part for new and legacy blank names across shared display services", async () => {
  const context = await auth.$context;
  const email = `no-name-${suffix}@authright.com`;
  const created = await context.internalAdapter.createUser(
    { name: " \t ", email, emailVerified: true },
    { method: "oauth", oauth: { providerId: "google" } },
  );
  expect(created.name).toBe(`no-name-${suffix}`);
  await context.internalAdapter.createSession(created.id);
  const reader: Actor = { userId: created.id, transport: "web", scopes: [] };
  await db.update(user).set({ name: " " }).where(eq(user.id, created.id));
  await db
    .update(members)
    .set({ role: "admin" })
    .where(eq(members.userId, created.id));
  const saved = await shareLink(reader, {
    url: `https://example.com/name-${suffix}`,
    idempotency_key: `name-${suffix}`,
  });
  const { accountProfile } = await import("../../src/server/account.ts");
  const { listMembers } = await import("../../src/server/member-search.ts");
  const { listAdminMembers } =
    await import("../../src/server/admin-members.ts");
  expect((await accountProfile(reader)).name).toBe(`no-name-${suffix}`);
  expect((await listMembers(reader, { query: email })).members[0].name).toBe(
    `no-name-${suffix}`,
  );
  expect(
    (await listAdminMembers(reader, { query: email })).members[0].name,
  ).toBe(`no-name-${suffix}`);
  const detail = await getShare(reader, saved.share.id);
  expect(detail.sharer.name).toBe(`no-name-${suffix}`);
  expect(detail.shared_by.name).toBe(`no-name-${suffix}`);
  expect(detail).not.toHaveProperty("email");
  expect(
    (await listShares(reader, { user_id: created.id })).items[0].sharer.name,
  ).toBe(`no-name-${suffix}`);
  await db
    .update(user)
    .set({ name: "Google Name" })
    .where(eq(user.id, created.id));
  expect((await getShare(reader, saved.share.id)).sharer.name).toBe(
    "Google Name",
  );
});

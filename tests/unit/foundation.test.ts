import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  readEnv,
  webEnvSchema,
  workerEnvSchema,
} from "../../src/server/env.ts";
import { createLogger } from "../../src/server/logger.ts";
import { errorResponse } from "../../src/server/errors.ts";
import { clientBoundaryViolations } from "../../scripts/lib/client-boundaries.ts";

const env = {
  DATABASE_URL: "postgresql://test:password@localhost/sharing_test",
  APP_URL: "http://localhost:3000",
  MCP_RESOURCE_URL: "http://localhost:3000/mcp",
  GOOGLE_WORKSPACE_DOMAIN: "authright.com",
  BETTER_AUTH_SECRET: "auth-secret-".repeat(4),
  CURSOR_SIGNING_SECRET: "cursor-secret-".repeat(4),
};
describe("environment boundaries", () => {
  it("rejects mismatched origins, resource, reused secrets and partial Google credentials", () => {
    for (const patch of [
      { BETTER_AUTH_URL: "https://other.example" },
      { MCP_RESOURCE_URL: "http://localhost:3000/other" },
      { CURSOR_SIGNING_SECRET: env.BETTER_AUTH_SECRET },
      { GOOGLE_CLIENT_ID: "client-without-secret" },
      { DATABASE_URL: "https://user:secret@example.com/db" },
      { APP_URL: "https://example.com/path" },
    ])
      expect(() => readEnv(webEnvSchema, { ...env, ...patch })).toThrow(
        "Invalid environment configuration",
      );
    expect(readEnv(webEnvSchema, env).APP_URL).toBe(env.APP_URL);
  });
  it("validates production transport and hides invalid values in errors", () => {
    expect(() =>
      readEnv(webEnvSchema, {
        ...env,
        NODE_ENV: "production",
        APP_URL: "http://public.example",
        MCP_RESOURCE_URL: "http://public.example/mcp",
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
      }),
    ).toThrow("APP_URL");
    try {
      readEnv(webEnvSchema, {
        ...env,
        DATABASE_URL: "BAD_PRIVATE_SECRET_VALUE",
      });
      expect.fail("must reject invalid URL");
    } catch (error) {
      expect(String(error)).not.toContain("BAD_PRIVATE_SECRET_VALUE");
    }
  });
  it("worker starts with database configuration alone and bounds concurrency", () => {
    expect(
      readEnv(workerEnvSchema, { DATABASE_URL: env.DATABASE_URL }),
    ).toMatchObject({ WORKER_CONCURRENCY: 2, SUMMARY_CONCURRENCY: 1 });
    expect(() =>
      readEnv(workerEnvSchema, {
        DATABASE_URL: env.DATABASE_URL,
        WORKER_CONCURRENCY: "1",
        SUMMARY_CONCURRENCY: "2",
      }),
    ).toThrow();
    expect(() =>
      readEnv(workerEnvSchema, {
        DATABASE_URL: env.DATABASE_URL,
        CONTENT_PROCESSING_ENABLED: "true",
      }),
    ).toThrow("GEMINI_BILLING_TIER");
    expect(
      readEnv(workerEnvSchema, {
        DATABASE_URL: env.DATABASE_URL,
        CONTENT_PROCESSING_ENABLED: "true",
        GEMINI_BILLING_TIER: "free",
      }),
    ).toMatchObject({ GEMINI_BILLING_TIER: "free" });
    expect(
      readEnv(workerEnvSchema, {
        DATABASE_URL: env.DATABASE_URL,
        YOUTUBE_PROXY_URL: "socks5://proxy.internal:1080",
      }).YOUTUBE_PROXY_URL,
    ).toBe("socks5://proxy.internal:1080");
    expect(() =>
      readEnv(workerEnvSchema, {
        DATABASE_URL: env.DATABASE_URL,
        YOUTUBE_PROXY_URL: "socks5://user:secret@proxy.internal:1080",
      }),
    ).toThrow("YOUTUBE_PROXY_URL");
  });
});
it("logs only correlation metadata, dropping nested credentials, bodies, errors and messages", () => {
  let output = "";
  const log = createLogger("info", {
    write: (chunk: string) => {
      output += chunk;
    },
  });
  const requestId = randomUUID();
  log.error(
    {
      event: "provider_failed",
      requestId,
      req: { headers: { authorization: "SECRET" } },
      err: new Error("SECRET"),
      response: { text: "ARTICLE_BODY" },
      url: "https://example.com/?key=SECRET",
    },
    "SECRET",
  );
  log.error("SECRET");
  const lines = output
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(lines[0]).toMatchObject({ event: "provider_failed", requestId });
  expect(output).not.toMatch(/SECRET|ARTICLE_BODY|https:/);
});
it("unknown HTTP errors expose a correlation ID without internal details", async () => {
  const response = errorResponse(new Error("provider secret and stack"));
  const body = await response.json();
  expect(response.status).toBe(500);
  expect(response.headers.get("x-request-id")).toBe(body.error.request_id);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(JSON.stringify(body)).not.toContain("provider secret");
});
it("rejects server imports through a client barrel while permitting type-only imports", () => {
  const root = mkdtempSync(path.join(tmpdir(), "sharing-boundary-"));
  try {
    mkdirSync(path.join(root, "src/server"), { recursive: true });
    writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { moduleResolution: "bundler", module: "esnext" },
        include: ["src/**/*.ts"],
      }),
    );
    writeFileSync(
      path.join(root, "src/server/secret.ts"),
      "export const secret = 'private'; export type Actor = string;",
    );
    writeFileSync(
      path.join(root, "src/barrel.ts"),
      "export { secret } from './server/secret';",
    );
    writeFileSync(
      path.join(root, "src/client.ts"),
      "'use client'; import { secret } from './barrel';",
    );
    expect(clientBoundaryViolations(root)).toHaveLength(1);
    writeFileSync(
      path.join(root, "src/client.ts"),
      "'use client'; import type { Actor } from './server/secret';",
    );
    expect(clientBoundaryViolations(root)).toEqual([]);
    writeFileSync(
      path.join(root, "src/client.ts"),
      "'use client'; const data = import('./barrel');",
    );
    expect(clientBoundaryViolations(root)).toHaveLength(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import { isolated } from "../helpers/database.ts";
import { describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  copyFile,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PgBoss } from "pg-boss";
import { bootstrapAdmin } from "../../src/server/bootstrap.ts";

// Never reset the application or shared test DB. Run unmodified migrations in
// disposable databases created by this invocation, then remove only those names.
async function migrateS1(pool: pg.Pool) {
  const folder = await mkdtemp(path.join(tmpdir(), "sharing-s1-migrations-"));
  try {
    await mkdir(path.join(folder, "meta"));
    const journal = JSON.parse(
      await readFile("drizzle/meta/_journal.json", "utf8"),
    );
    journal.entries = journal.entries.slice(0, 2);
    await writeFile(
      path.join(folder, "meta/_journal.json"),
      JSON.stringify(journal),
    );
    for (const entry of journal.entries)
      await copyFile(
        `drizzle/${entry.tag}.sql`,
        path.join(folder, `${entry.tag}.sql`),
      );
    await migrate(drizzle(pool), { migrationsFolder: folder });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

describe("A1 migration and database invariants", () => {
  it("creates a fresh database, repeats migrations and bootstrap without promoting ordinary members", async () => {
    await isolated(async (pool) => {
      const db = drizzle(pool);
      await migrate(db, { migrationsFolder: "drizzle" });
      await migrate(db, { migrationsFolder: "drizzle" });
      const first = await bootstrapAdmin(
        " ADMIN@authright.com ",
        "authright.com",
        db,
      );
      const second = await bootstrapAdmin(
        "admin@authright.com",
        "authright.com",
        db,
      );
      expect(second.id).toBe(first.id);
      await pool.query("update members set status = 'disabled' where id = $1", [
        first.id,
      ]);
      expect(
        (await bootstrapAdmin("admin@authright.com", "authright.com", db)).id,
      ).toBe(first.id);
      await pool.query(
        "insert into members (allowed_email) values ('member@authright.com')",
      );
      await expect(
        bootstrapAdmin("member@authright.com", "authright.com", db),
      ).rejects.toThrow("not promoted");
      expect(
        (
          await pool.query(
            "select quota_enabled, monthly_call_limit, version from settings",
          )
        ).rows,
      ).toEqual([
        { quota_enabled: false, monthly_call_limit: null, version: 1 },
      ]);
    });
  });
  it("upgrades S1 preserving shares, sessions, grants, idempotency and real queued jobs", async () => {
    await isolated(async (pool) => {
      await migrateS1(pool);
      const db = drizzle(pool);
      const boss = new PgBoss({
        connectionString: pool.options.connectionString!,
        supervise: false,
        schedule: false,
      });
      try {
        await boss.start();
        await boss.createQueue("process-content");
        const contentId = randomUUID(),
          shareId = randomUUID(),
          taskId = randomUUID();
        await pool.query(
          `insert into "user" (id, name, email, email_verified) values ('legacy', 'Legacy', 'legacy@authright.com', true)`,
        );
        await pool.query(
          "insert into members (allowed_email, user_id, role) values ('legacy@authright.com', 'legacy', 'admin')",
        );
        await pool.query(
          "insert into session (id, token, user_id, expires_at, updated_at) values ('legacy-session', 'test-session', 'legacy', now() + interval '1 day', now())",
        );
        await pool.query(
          "insert into agent_grants (user_id, client_id, session_id, authorization_code_id) values ('legacy', 'client', 'legacy-session', 'code')",
        );
        await pool.query(
          "insert into contents (id, dedupe_key, normalized_url, original_url, type) values ($1, 'youtube:dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ', 'youtube')",
          [contentId],
        );
        await pool.query(
          "insert into shares (id, content_id, user_id, original_url) values ($1, $2, 'legacy', 'https://youtu.be/dQw4w9WgXcQ?t=2')",
          [shareId, contentId],
        );
        const jobId = await boss.send("process-content", {
          contentId,
          generation: 1,
        });
        await pool.query(
          "insert into content_tasks (id, content_id, job_id) values ($1, $2, $3)",
          [taskId, contentId, jobId],
        );
        await pool.query(
          "insert into idempotency_keys (user_id, operation, key, fingerprint, share_id) values ('legacy', 'share_link', 'legacy-key', 'hash', $1)",
          [shareId],
        );
        const tables = ["shares", "session", "idempotency_keys", "pgboss.job"];
        const before = await Promise.all(
          tables.map(
            async (table) => (await pool.query(`select * from ${table}`)).rows,
          ),
        );
        await migrate(db, { migrationsFolder: "drizzle" });
        const after = await Promise.all(
          tables.map(
            async (table) => (await pool.query(`select * from ${table}`)).rows,
          ),
        );
        expect(after).toEqual(before);
        expect(
          (
            await pool.query(
              "select id, state, kind, generation, job_id from content_tasks",
            )
          ).rows,
        ).toEqual([
          {
            id: taskId,
            state: "queued",
            kind: "process_content",
            generation: 1,
            job_id: jobId,
          },
        ]);
        expect(
          (await pool.query("select video_id, status from contents")).rows[0],
        ).toEqual({ video_id: "dQw4w9WgXcQ", status: "queued" });
        expect(
          (
            await pool.query(
              "select user_id, authorization_code_id, revoked_at, scopes from agent_grants",
            )
          ).rows[0],
        ).toEqual({
          user_id: "legacy",
          authorization_code_id: "code",
          revoked_at: null,
          scopes: ["shares:read"],
        });
      } finally {
        await boss.stop();
      }
    });
  });
  it("enforces active task, usage, quota, foreign key and singleton constraints under concurrency", async () => {
    await isolated(async (pool) => {
      await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
      const contentId = randomUUID();
      await pool.query(
        "insert into contents (id, dedupe_key, normalized_url, original_url, type) values ($1, 'article:test', 'https://example.com', 'https://example.com', 'article')",
        [contentId],
      );
      const insert = () =>
        pool.query(
          "insert into content_tasks (content_id, job_id) values ($1, $2) returning id",
          [contentId, randomUUID()],
        );
      const results = await Promise.allSettled([insert(), insert()]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      for (const state of ["retry_wait", "deferred_quota", "processing"]) {
        await pool.query("update content_tasks set state = $1", [state]);
        await expect(insert()).rejects.toMatchObject({ code: "23505" });
      }
      const taskId = (await pool.query("select id from content_tasks")).rows[0]
        .id;
      const attemptId = randomUUID();
      await pool.query(
        "insert into processing_attempts (id, task_id, generation, attempt_no, stage) values ($1, $2, 1, 1, 'summarize')",
        [attemptId, taskId],
      );
      await expect(
        pool.query(
          "insert into processing_attempts (task_id, generation, attempt_no, stage) values ($1, 1, 1, 'summarize')",
          [taskId],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await pool.query(
        "insert into usage_events (attempt_id, service, status) values ($1, 'summary', 'outcome_unknown')",
        [attemptId],
      );
      expect(
        (
          await pool.query(
            "select usage_known, input_tokens, estimated_amount from usage_events",
          )
        ).rows[0],
      ).toEqual({
        usage_known: false,
        input_tokens: null,
        estimated_amount: null,
      });
      await expect(
        pool.query("update usage_events set input_tokens = 0"),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        pool.query(
          "insert into usage_events (attempt_id, service, status) values ($1, 'summary', 'succeeded')",
          [attemptId],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      const reserve = () =>
        pool.query(
          "insert into quota_reservations (attempt_id, billing_month) values ($1, '2026-09-01')",
          [attemptId],
        );
      const reservations = await Promise.allSettled([reserve(), reserve()]);
      expect(
        reservations.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      await expect(
        pool.query(
          "update quota_reservations set billing_month = '2026-09-02'",
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        pool.query("update settings set quota_enabled = true"),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        pool.query("insert into settings (id) values (2)"),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        pool.query("update contents set status = 'fictional'"),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        pool.query(
          "insert into content_tasks (content_id, job_id) values ($1, $2)",
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await pool.query("update content_tasks set state = 'failed'");
      await expect(insert()).resolves.toBeDefined();
    });
  });
});

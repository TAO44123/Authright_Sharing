import { expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { isolated } from "../helpers/database.ts";
import {
  changeMember,
  listAdminMembers,
} from "../../src/server/admin-members.ts";
import {
  bindMembership,
  requireMember,
  type Actor,
} from "../../src/server/membership.ts";
import {
  members,
  auditEvents,
  contents,
  shares,
} from "../../src/server/db/schema.ts";
import { user } from "../../src/server/db/auth-schema.ts";
it("joins company identities automatically, preserves identity and protects administrator roles", async () => {
  await isolated(async (pool) => {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: "drizzle" });
    for (const id of ["admin1", "admin2", "member"]) {
      await db.insert(user).values({
        id,
        name: "Same Name",
        email: `${id}@authright.com`,
        emailVerified: true,
      });
      if (id.startsWith("admin"))
        await db.insert(members).values({
          allowedEmail: `${id}@authright.com`,
          role: "admin",
          status: "disabled",
        });
      await Promise.all([bindMembership(id, db), bindMembership(id, db)]);
    }
    const actor = (userId: string): Actor => ({
      userId,
      transport: "web",
      scopes: [],
    });
    expect(await db.select().from(members)).toHaveLength(3);
    const member = (
      await db.select().from(members).where(eq(members.userId, "member"))
    )[0];
    expect(member).toMatchObject({ role: "member", status: "active" });
    await expect(
      changeMember(actor("member"), member.id, { role: "admin" }, db),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      listAdminMembers({ ...actor("admin1"), transport: "mcp" }, {}, db),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      changeMember(actor("admin1"), member.id, { status: "disabled" }, db),
    ).rejects.toThrow();
    const [content] = await db
      .insert(contents)
      .values({
        type: "article",
        dedupeKey: "test",
        originalUrl: "https://example.com",
        normalizedUrl: "https://example.com",
      })
      .returning();
    await db.insert(shares).values({
      userId: "member",
      contentId: content.id,
      originalUrl: "https://example.com",
    });
    await db
      .update(user)
      .set({ email: "changed@authright.com", name: "Changed" })
      .where(eq(user.id, "member"));
    await bindMembership("member", db);
    expect((await db.select().from(shares))[0].userId).toBe("member");
    await db
      .update(members)
      .set({ status: "disabled" })
      .where(eq(members.id, member.id));
    expect((await requireMember("member", db)).id).toBe(member.id);
    await bindMembership("member", db);
    expect((await requireMember("member", db)).status).toBe("active");
    expect(
      (await listAdminMembers(actor("admin1"), {}, db)).members.find(
        (m) => m.userId === "member",
      )?.email,
    ).toBe("changed@authright.com");
    expect(await db.select().from(shares)).toHaveLength(1);
    for (const identity of [
      { email: "outside@example.com", emailVerified: true },
      { email: "outside@authright.com.evil.example", emailVerified: true },
      { email: "unverified@authright.com", emailVerified: false },
    ]) {
      await db.update(user).set(identity).where(eq(user.id, "member"));
      await expect(requireMember("member", db)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(bindMembership("member", db)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    const admins = await db
      .select()
      .from(members)
      .where(eq(members.role, "admin"));
    const results = await Promise.allSettled(
      admins.map((m) =>
        changeMember(actor(m.userId!), m.id, { role: "member" }, db),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await db.select().from(members).where(eq(members.role, "admin")),
    ).toHaveLength(1);
    expect(await db.select().from(auditEvents)).toHaveLength(1);
  });
});

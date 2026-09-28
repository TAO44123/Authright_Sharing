import { and, eq, gt, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db/index.ts";
import { members, auditEvents } from "./db/schema.ts";
import { user } from "./db/auth-schema.ts";
import { type Actor, requireMember } from "./membership.ts";
import { AppError } from "./errors.ts";
import { config } from "./config.ts";
import { displayName } from "./display-name.ts";

export const changeMemberInput = z
  .object({
    role: z.enum(["admin", "member"]),
  })
  .strict();
export async function requireAdmin(
  actor: Actor,
  database: Pick<typeof db, "select"> = db,
) {
  const member = await requireMember(actor.userId, database);
  if (actor.transport !== "web" || member.role !== "admin")
    throw new AppError("FORBIDDEN", "Administrator access required.", 403);
  return member;
}
export async function listAdminMembers(
  actor: Actor,
  input: unknown = {},
  database = db,
) {
  await requireAdmin(actor, database);
  const q = z
    .object({
      query: z.string().trim().max(200).optional(),
      after: z.uuid().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    })
    .strict()
    .parse(input);
  const query = q.query?.replace(/[\\%_]/g, "\\$&");
  const rows = await database
    .select({
      id: members.id,
      userId: user.id,
      email: user.email,
      name: user.name,
      role: members.role,
    })
    .from(members)
    .innerJoin(user, eq(members.userId, user.id))
    .where(
      and(
        query ? ilike(user.email, `%${query}%`) : undefined,
        q.after ? gt(members.id, q.after) : undefined,
      ),
    )
    .orderBy(members.id)
    .limit(q.limit + 1);
  return {
    members: rows
      .slice(0, q.limit)
      .map((row) => ({ ...row, name: displayName(row.name, row.email) })),
    next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
  };
}
// Role management does not grant or deny company users access to Sharing.
export async function changeMember(
  actor: Actor,
  id: string,
  input: unknown,
  database = db,
) {
  const value = changeMemberInput.parse(input);
  z.uuid().parse(id);
  return database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(820019)`);
    await requireAdmin(actor, tx);
    const [before] = await tx
      .select()
      .from(members)
      .where(eq(members.id, id))
      .for("update");
    if (!before) throw new AppError("NOT_FOUND", "Member not found.", 404);
    const role = value.role;
    if (before.role === "admin" && role !== "admin") {
      const admins = await tx
        .select({ id: members.id })
        .from(members)
        .innerJoin(user, eq(user.id, members.userId))
        .where(
          and(
            eq(members.role, "admin"),
            eq(user.emailVerified, true),
            sql`lower(split_part(${user.email}, '@', 2)) = ${config.GOOGLE_WORKSPACE_DOMAIN}`,
          ),
        );
      if (admins.length <= 1)
        throw new AppError(
          "CONFLICT",
          "Keep at least one company administrator.",
          409,
        );
    }
    const [updated] = await tx
      .update(members)
      .set({ role, updatedAt: new Date() })
      .where(eq(members.id, id))
      .returning();
    await tx.insert(auditEvents).values({
      actorId: actor.userId,
      action: "member_role_changed",
      targetId: id,
      changes: {
        role: { before: before.role, after: role },
      },
    });
    return updated;
  });
}

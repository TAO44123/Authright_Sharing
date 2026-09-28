import { and, eq, gt, ilike, or, sql } from "drizzle-orm";
import { db } from "./db/index.ts";
import { members } from "./db/schema.ts";
import { user } from "./db/auth-schema.ts";
import { authorize, type Actor } from "./membership.ts";
import { listMembersInput } from "../contracts/index.ts";
import { encodeCursor, decodeCursor } from "./cursor.ts";
import { AppError } from "./errors.ts";
import { config } from "./config.ts";
import { isCompanyIdentity } from "./company-identity.ts";
import { displayName } from "./display-name.ts";
export async function listMembers(actor: Actor, input: unknown = {}) {
  await authorize(actor, "members:read");
  const q = listMembersInput.parse(input);
  const cursor = q.cursor ? decodeCursor(q.cursor) : null;
  if (
    cursor &&
    (cursor.kind !== "members" ||
      cursor.actor !== actor.userId ||
      (q.query !== undefined && q.query !== cursor.query) ||
      typeof cursor.lastId !== "string" ||
      typeof cursor.limit !== "number")
  )
    throw new AppError("INVALID_CURSOR", "Member filters changed.");
  const query = (cursor?.query as string | undefined) ?? q.query;
  const escaped = query?.replace(/[\\%_]/g, "\\$&");
  const limit = (cursor?.limit as number | undefined) ?? q.limit;
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
    })
    .from(members)
    .innerJoin(user, eq(members.userId, user.id))
    .where(
      and(
        or(
          and(
            eq(user.emailVerified, true),
            sql`lower(split_part(${user.email}, '@', 2)) = ${config.GOOGLE_WORKSPACE_DOMAIN}`,
          ),
          sql`exists (select 1 from shares where shares.user_id = ${user.id})`,
        ),
        escaped
          ? or(
              ilike(user.name, `%${escaped}%`),
              ilike(user.email, `%${escaped}%`),
            )
          : undefined,
        cursor ? gt(user.id, cursor.lastId as string) : undefined,
      ),
    )
    .orderBy(user.id)
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    members: page.map(({ emailVerified, ...row }) => ({
      ...row,
      name: displayName(row.name, row.email),
      active: isCompanyIdentity(
        { email: row.email, emailVerified },
        config.GOOGLE_WORKSPACE_DOMAIN,
      ),
    })),
    next_cursor:
      rows.length > limit
        ? encodeCursor({
            kind: "members",
            actor: actor.userId,
            query,
            limit,
            lastId: page.at(-1)!.id,
          })
        : null,
  };
}

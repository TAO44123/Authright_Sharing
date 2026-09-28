import { and, eq, isNull, notExists, or } from "drizzle-orm";
import { db } from "./db/index.ts";
import { members, agentGrants } from "./db/schema.ts";
import { user, oauthConsent, oauthRefreshToken } from "./db/auth-schema.ts";
import { AppError } from "./errors.ts";
import { config } from "./config.ts";
import { isCompanyIdentity } from "./company-identity.ts";

export type Actor = {
  userId: string;
  transport: "web" | "mcp";
  scopes: readonly string[];
  grantId?: string;
  clientId?: string;
};
export async function requireMember(
  userId: string,
  database: Pick<typeof db, "select"> = db,
) {
  const [record] = await database
    .select({ member: members, identity: user })
    .from(members)
    .innerJoin(user, eq(user.id, members.userId))
    .where(eq(members.userId, userId));
  if (
    !record ||
    !isCompanyIdentity(record.identity, config.GOOGLE_WORKSPACE_DOMAIN)
  )
    throw new AppError(
      "FORBIDDEN",
      "A verified company Google account is required.",
      403,
    );
  // Legacy allowlist status is no longer an access restriction.
  return record.member;
}
export async function authorize(
  actor: Actor,
  scope: string,
  database: Pick<typeof db, "select"> = db,
) {
  await requireMember(actor.userId, database);
  if (actor.transport === "mcp") {
    if (!actor.scopes.includes(scope))
      throw new AppError(
        "FORBIDDEN",
        `The ${scope} permission is required. Reconnect this agent with that permission.`,
        403,
      );
    const [grant] = actor.grantId
      ? await database
          .select()
          .from(agentGrants)
          .where(
            and(
              eq(agentGrants.id, actor.grantId),
              eq(agentGrants.userId, actor.userId),
              eq(agentGrants.clientId, actor.clientId ?? ""),
            ),
          )
      : [];
    if (!grant || grant.revokedAt)
      throw new AppError(
        "GRANT_REVOKED",
        "This connection has been revoked. Reconnect this agent and allow access again.",
        401,
      );
  }
}
export async function bindMembership(userId: string, database = db) {
  await database.transaction(async (tx) => {
    // Serialize concurrent first sessions for the same authenticated identity.
    const [u] = await tx
      .select()
      .from(user)
      .where(eq(user.id, userId))
      .for("update");
    if (!u || !isCompanyIdentity(u, config.GOOGLE_WORKSPACE_DOMAIN))
      throw new AppError(
        "FORBIDDEN",
        "A verified company Google account is required.",
        403,
      );
    const [existing] = await tx
      .select()
      .from(members)
      .where(eq(members.userId, userId))
      .for("update");
    if (existing) {
      await tx
        .update(members)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(members.id, existing.id));
      return;
    }
    // Preserve a preconfigured administrator role from bootstrap/old records.
    await tx
      .insert(members)
      .values({ allowedEmail: u.email.toLowerCase() })
      .onConflictDoNothing();
    const [bound] = await tx
      .update(members)
      .set({ userId, status: "active", updatedAt: new Date() })
      .where(
        and(
          eq(members.allowedEmail, u.email.toLowerCase()),
          or(isNull(members.userId), eq(members.userId, userId)),
        ),
      )
      .returning();
    if (!bound)
      throw new AppError(
        "FORBIDDEN",
        "This identity is already linked to another account.",
        403,
      );
  });
}
export async function issueGrant(
  userId: string,
  clientId: string,
  sessionId: string,
  authorizationCodeId: string | null,
  canCreate: boolean,
  scopes: readonly string[] = ["shares:read"],
) {
  await requireMember(userId);
  if (canCreate && authorizationCodeId)
    await db
      .insert(agentGrants)
      .values({
        userId,
        clientId,
        sessionId,
        authorizationCodeId,
        scopes: scopes.filter((scope) =>
          ["shares:read", "shares:write", "members:read"].includes(scope),
        ),
      })
      .onConflictDoNothing();
  const identity = and(
    eq(agentGrants.userId, userId),
    eq(agentGrants.clientId, clientId),
    eq(agentGrants.sessionId, sessionId),
  );
  let [grant] = await db
    .select()
    .from(agentGrants)
    .where(
      and(
        identity,
        authorizationCodeId
          ? eq(agentGrants.authorizationCodeId, authorizationCodeId)
          : isNull(agentGrants.authorizationCodeId),
      ),
    );
  // Legacy refresh tokens stay attached to their original legacy connection.
  // Never select the latest/active grant, which would revive revoked tokens.
  if (!grant && !canCreate)
    [grant] = await db
      .select()
      .from(agentGrants)
      .where(and(identity, isNull(agentGrants.authorizationCodeId)));
  if (!grant || grant.revokedAt)
    throw new AppError(
      "GRANT_REVOKED",
      "Reconnect this agent and allow access again.",
      401,
    );
  return grant.id;
}
export async function revokeGrant(actor: Actor, id: string) {
  await authorize(actor, "shares:read");
  await db.transaction(async (tx) => {
    const [grant] = await tx
      .update(agentGrants)
      .set({ revokedAt: new Date() })
      .where(and(eq(agentGrants.id, id), eq(agentGrants.userId, actor.userId)))
      .returning();
    if (!grant) throw new AppError("NOT_FOUND", "Connection not found.", 404);
    // Remove this authorization's entire refresh chain, including rotated rows.
    // Otherwise replaying a rotated token can trigger the provider's client-wide
    // reuse response and invalidate an independently reconnected authorization.
    await tx
      .delete(oauthRefreshToken)
      .where(
        and(
          eq(oauthRefreshToken.userId, grant.userId),
          eq(oauthRefreshToken.clientId, grant.clientId),
          eq(oauthRefreshToken.sessionId, grant.sessionId),
          grant.authorizationCodeId
            ? eq(
                oauthRefreshToken.authorizationCodeId,
                grant.authorizationCodeId,
              )
            : notExists(
                tx
                  .select({ id: agentGrants.id })
                  .from(agentGrants)
                  .where(
                    eq(
                      agentGrants.authorizationCodeId,
                      oauthRefreshToken.authorizationCodeId,
                    ),
                  ),
              ),
        ),
      );
    // The next OAuth authorization must show consent again. Other existing
    // connections keep their own grants and tokens; the web session stays valid.
    await tx
      .delete(oauthConsent)
      .where(
        and(
          eq(oauthConsent.userId, actor.userId),
          eq(oauthConsent.clientId, grant.clientId),
        ),
      );
  });
}

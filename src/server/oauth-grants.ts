import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "./db/index.ts";
import { oauthRefreshToken } from "./db/auth-schema.ts";
import { AppError } from "./errors.ts";
import { issueGrant } from "./membership.ts";

// Explicitly shared with the provider's storeTokens option. This matches its
// existing SHA-256/base64url default, so stored credentials remain compatible.
export function hashOAuthToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

// Called only by the provider's claims hook AFTER code/PKCE or refresh-token
// validation. Raw request fields identify the verified authorization; they
// never establish the user, client, session, or permission to issue tokens.
export async function grantForToken(input: {
  userId: string;
  clientId: string;
  sessionId: string;
  scopes: string[];
  grantType?: string;
  body: Record<string, unknown>;
}) {
  const { userId, clientId, sessionId, scopes, grantType, body } = input;
  if (grantType === "authorization_code" && typeof body.code === "string")
    return issueGrant(
      userId,
      clientId,
      sessionId,
      hashOAuthToken(body.code),
      true,
      scopes,
    );

  if (grantType === "refresh_token" && typeof body.refresh_token === "string") {
    const [refresh] = await db
      .select()
      .from(oauthRefreshToken)
      .where(
        and(
          eq(oauthRefreshToken.token, hashOAuthToken(body.refresh_token)),
          eq(oauthRefreshToken.userId, userId),
          eq(oauthRefreshToken.clientId, clientId),
          eq(oauthRefreshToken.sessionId, sessionId),
        ),
      );
    if (refresh && !refresh.revoked && refresh.expiresAt > new Date())
      return issueGrant(
        userId,
        clientId,
        sessionId,
        refresh.authorizationCodeId,
        false,
        scopes,
      );
  }
  throw new AppError(
    "GRANT_REVOKED",
    "Reconnect this agent and allow access again.",
    401,
  );
}

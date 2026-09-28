import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { db } from "./db/index.ts";
import { config, googleConfigured } from "./config.ts";
import * as authSchema from "./db/auth-schema.ts";
import { APIError } from "better-auth/api";
import { bindMembership } from "./membership.ts";
import { grantForToken, hashOAuthToken } from "./oauth-grants.ts";
import { AppError } from "./errors.ts";
import { isCompanyIdentity } from "./company-identity.ts";
import { displayName } from "./display-name.ts";
import { SHARING_MCP_SCOPES } from "./mcp-scopes.ts";

export const authOptions = {
  appName: "Sharing",
  baseURL: config.APP_URL,
  secret: config.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  trustedOrigins: [config.APP_URL],
  account: { accountLinking: { enabled: false } },
  session: { cookieCache: { enabled: false } },
  onAPIError: { errorURL: `${config.APP_URL}/auth-error` },
  databaseHooks: {
    user: {
      create: {
        before: async (data) => {
          if (!isCompanyIdentity(data, config.GOOGLE_WORKSPACE_DOMAIN))
            throw new APIError("FORBIDDEN", {
              message: "A verified company Google account is required.",
            });
          return {
            data: { ...data, name: displayName(data.name, data.email) },
          };
        },
      },
    },
    session: {
      create: {
        before: async (data) => {
          try {
            await bindMembership(data.userId);
          } catch {
            throw new APIError("FORBIDDEN", {
              message: "A verified company Google account is required.",
            });
          }
          return { data };
        },
      },
    },
  },
  socialProviders: googleConfigured
    ? {
        google: {
          clientId: config.GOOGLE_CLIENT_ID,
          clientSecret: config.GOOGLE_CLIENT_SECRET,
          mapProfileToUser: async (profile) => {
            if (
              !isCompanyIdentity(
                {
                  email: profile.email,
                  emailVerified: profile.email_verified === true,
                },
                config.GOOGLE_WORKSPACE_DOMAIN,
              )
            )
              throw new APIError("FORBIDDEN", {
                message: "Verified company account required.",
              });
            const email = profile.email.toLowerCase();
            return { email, name: displayName(profile.name, email) };
          },
        },
      }
    : {},
  plugins: [
    jwt(),
    mcp({
      loginPage: "/sign-in",
      consentPage: "/consent",
      resource: config.MCP_RESOURCE_URL,
      scopes: [
        "openid",
        "profile",
        "email",
        "offline_access",
        ...SHARING_MCP_SCOPES,
      ],
      grantTypes: ["authorization_code", "refresh_token"],
      refreshTokenReuseInterval: 0,
      storeTokens: { hash: hashOAuthToken },
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      allowPublicClientPrelogin: true,
      extensions: [
        {
          claims: {
            accessToken: async ({
              ctx,
              user,
              client,
              scopes,
              sessionId,
              grantType,
            }) => {
              if (!user || !sessionId)
                throw new APIError("BAD_REQUEST", {
                  error: "invalid_grant",
                  error_description:
                    "Authorization session is no longer available. Start authorization again.",
                });
              try {
                return {
                  sharing_grant: await grantForToken({
                    userId: user.id,
                    clientId: client.clientId,
                    sessionId,
                    scopes,
                    grantType,
                    body: ctx.body ?? {},
                  }),
                };
              } catch (error) {
                if (!(error instanceof AppError)) throw error;
                throw new APIError("BAD_REQUEST", {
                  error: "invalid_grant",
                  error_description:
                    "Authorization is no longer valid. Reconnect this agent and allow access again.",
                });
              }
            },
          },
        },
      ],
    }),
    cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
  ],
} satisfies BetterAuthOptions;

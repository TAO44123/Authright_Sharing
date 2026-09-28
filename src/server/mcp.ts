import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { requireMcpAuth } from "@better-auth/mcp";
import { auth } from "./auth.ts";
import { config } from "./config.ts";
import { AppError, errorResponse } from "./errors.ts";
import { type Actor, authorize } from "./membership.ts";
import { getShare, listShares, shareLink, withdrawShare } from "./shares.ts";
import { listMembers } from "./member-search.ts";
import { contracts } from "../contracts/index.ts";
import { logger } from "./logger.ts";
import { mcpAuthErrorResponse } from "./mcp-auth-error.ts";
import { SHARING_MCP_SCOPES } from "./mcp-scopes.ts";

export const mcpHandler = requireMcpAuth(
  auth,
  async (request, claims) => {
    if (
      request.headers.get("origin") &&
      request.headers.get("origin") !== new URL(config.APP_URL).origin
    )
      return errorResponse(new AppError("FORBIDDEN", "Invalid origin.", 403));
    if (
      typeof claims.sub !== "string" ||
      typeof claims.client_id !== "string" ||
      typeof claims.sharing_grant !== "string"
    )
      return mcpAuthErrorResponse(
        new AppError("UNAUTHENTICATED", "Invalid platform access token.", 401),
      );
    const actor: Actor = {
      userId: claims.sub,
      transport: "mcp",
      clientId: claims.client_id,
      grantId: claims.sharing_grant,
      scopes: typeof claims.scope === "string" ? claims.scope.split(" ") : [],
    };
    try {
      await authorize(actor, "shares:read");
    } catch (e) {
      return mcpAuthErrorResponse(e);
    }
    const handler = createMcpHandler(
      () => {
        const server = new McpServer({ name: "Sharing", version: "0.1.0" });
        const wrap = async (fn: () => Promise<unknown>) => {
          try {
            const data = await fn();
            return {
              content: [{ type: "text" as const, text: JSON.stringify(data) }],
              structuredContent: data as Record<string, unknown>,
            };
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    error instanceof AppError
                      ? { code: error.code, message: error.message }
                      : {
                          code: "INTERNAL_ERROR",
                          message: "Unable to complete the Sharing request.",
                        },
                  ),
                },
              ],
            };
          }
        };
        server.registerTool(
          "list_shares",
          {
            description:
              "List team shares; defaults to the last seven days. Results are saved metadata, not full articles. Follow next_cursor for more.",
            inputSchema: contracts.list_shares.input,
            outputSchema: contracts.list_shares.output,
            annotations: { readOnlyHint: true, openWorldHint: false },
          },
          (input) => wrap(() => listShares(actor, input)),
        );
        server.registerTool(
          "get_share",
          {
            description:
              "Read a saved article summary, video audio summary, or author video description with its original source URL and processing status. Video summaries analyze audio only, not visuals. Full articles and transcripts are unavailable. Reading never starts processing.",
            inputSchema: contracts.get_share.input,
            outputSchema: contracts.get_share.output,
            annotations: { readOnlyHint: true, openWorldHint: false },
          },
          (input) => wrap(() => getShare(actor, input.share_id)),
        );
        server.registerTool(
          "share_link",
          {
            description:
              "Save a URL as your own share. Supply a stable idempotency_key for retries; use a new key to share again intentionally. Processing is asynchronous.",
            inputSchema: contracts.share_link.input,
            outputSchema: contracts.share_link.output,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
            scopeChallenge: () =>
              actor.scopes.includes("shares:write")
                ? undefined
                : {
                    scopes: ["shares:read", "shares:write"],
                    errorDescription: "shares:write is required to save links",
                  },
          },
          (input) => wrap(() => shareLink(actor, input)),
        );
        server.registerTool(
          "list_members",
          {
            description:
              "Find team members by name or email to disambiguate people before filtering shares by user_id. Follow next_cursor for more.",
            inputSchema: contracts.list_members.input,
            outputSchema: contracts.list_members.output,
            annotations: { readOnlyHint: true, openWorldHint: false },
            scopeChallenge: () =>
              actor.scopes.includes("members:read")
                ? undefined
                : {
                    scopes: ["shares:read", "members:read"],
                    errorDescription:
                      "members:read is required to find members",
                  },
          },
          (input) => wrap(() => listMembers(actor, input)),
        );
        server.registerTool(
          "withdraw_share",
          {
            description:
              "Withdraw one of your own shares by share_id. This hides that share from normal queries without affecting other people's shares of the same URL.",
            inputSchema: contracts.withdraw_share.input,
            outputSchema: contracts.withdraw_share.output,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: true,
              openWorldHint: false,
            },
            scopeChallenge: () =>
              actor.scopes.includes("shares:write")
                ? undefined
                : {
                    scopes: ["shares:read", "shares:write"],
                    errorDescription:
                      "shares:write is required to withdraw links",
                  },
          },
          (input) => wrap(() => withdrawShare(actor, input.share_id)),
        );
        return server;
      },
      {
        legacy: "stateless",
        onerror: () => logger.warn({ event: "mcp_request_error" }),
      },
    );
    return handler.fetch(request);
  },
  {
    resource: config.MCP_RESOURCE_URL,
    requiredScopes: ["shares:read"],
    challengeScopes: SHARING_MCP_SCOPES,
  },
);

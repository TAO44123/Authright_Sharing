import { config } from "./config.ts";
import { AppError, errorResponse } from "./errors.ts";
import { SHARING_MCP_SCOPES } from "./mcp-scopes.ts";

export function mcpAuthErrorResponse(error: unknown) {
  const response = errorResponse(error);
  if (error instanceof AppError && error.status === 401) {
    const resource = new URL(config.MCP_RESOURCE_URL);
    const metadata = new URL(
      `/.well-known/oauth-protected-resource${resource.pathname.replace(/\/$/, "")}`,
      resource,
    );
    response.headers.set(
      "WWW-Authenticate",
      `Bearer error="invalid_token", resource_metadata="${metadata}", scope="${SHARING_MCP_SCOPES.join(" ")}"`,
    );
    response.headers.set("Cache-Control", "no-store");
  }
  return response;
}

type AuthHandler = (request: Request) => Promise<Response>;

// Only interactive auth navigation gets a page. Fetch/SDK calls, token exchange,
// discovery and MCP keep their original status codes and structured responses.
export async function browserAuthResponse(
  request: Request,
  handler: AuthHandler,
  appUrl: string,
) {
  const path = new URL(request.url).pathname;
  const destination = request.headers.get("sec-fetch-dest");
  const isDocument = destination
    ? destination === "document"
    : Boolean(request.headers.get("accept")?.includes("text/html"));
  const interactive =
    isDocument &&
    (path.startsWith("/api/auth/callback/") ||
      path === "/api/auth/oauth2/authorize" ||
      path === "/api/auth/error");
  function errorPage(response?: Response) {
    const url = new URL("/auth-error", appUrl);
    url.searchParams.set(
      "error",
      !response || response.status >= 500
        ? "service_unavailable"
        : response.status === 403
          ? "access_denied"
          : "sign_in_failed",
    );
    const headers = new Headers({
      Location: url.toString(),
      "Cache-Control": "private, no-store",
    });
    // Preserve state-cookie cleanup performed by the authentication library.
    for (const cookie of response?.headers.getSetCookie() ?? [])
      headers.append("Set-Cookie", cookie);
    return new Response(null, { status: 303, headers });
  }
  let response;
  try {
    response = await handler(request);
  } catch (error) {
    if (!interactive) throw error;
    return errorPage();
  }
  return interactive && response.status >= 400 ? errorPage(response) : response;
}

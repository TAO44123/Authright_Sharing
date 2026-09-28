import { expect, it } from "vitest";
import { browserAuthResponse } from "../../src/server/browser-auth.ts";
const origin = "https://sharing.example.com";
const denied = () =>
  Response.json(
    { message: "private-provider-details" },
    {
      status: 403,
      headers: { "Set-Cookie": "oauth_state=; Max-Age=0; HttpOnly" },
    },
  );

it("turns a browser callback failure into a local page and preserves state cleanup without exposing the error", async () => {
  const result = await browserAuthResponse(
    new Request(`${origin}/api/auth/callback/google?code=SECRET`, {
      headers: { accept: "text/html", "sec-fetch-dest": "document" },
    }),
    async () => denied(),
    origin,
  );
  expect(result.status).toBe(303);
  expect(result.headers.get("location")).toBe(
    `${origin}/auth-error?error=access_denied`,
  );
  expect(result.headers.getSetCookie()).toEqual([
    "oauth_state=; Max-Age=0; HttpOnly",
  ]);
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(await result.text()).toBe("");
});

it.each([
  ["/api/auth/callback/google", "application/json", ""],
  ["/api/auth/callback/google", "text/html", "empty"],
  ["/api/auth/oauth2/authorize", "application/json", ""],
  ["/api/auth/oauth2/token", "text/html", "document"],
  ["/api/auth/get-session", "application/json", ""],
])(
  "preserves structured API errors at %s (%s, %s)",
  async (path, accept, destination) => {
    const response = denied();
    const headers = new Headers({ accept });
    if (destination) headers.set("sec-fetch-dest", destination);
    const result = await browserAuthResponse(
      new Request(`${origin}${path}`, { headers }),
      async () => response,
      origin,
    );
    expect(result).toBe(response);
    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({
      message: "private-provider-details",
    });
  },
);

it("keeps successful consent redirects and handles unexpected browser failures with a safe page", async () => {
  const request = new Request(`${origin}/api/auth/oauth2/authorize`, {
    headers: { accept: "text/html" },
  });
  const success = Response.redirect(`${origin}/consent?verified=signed`);
  expect(await browserAuthResponse(request, async () => success, origin)).toBe(
    success,
  );
  const result = await browserAuthResponse(
    request,
    async () => {
      throw new Error("SECRET");
    },
    origin,
  );
  expect(result.headers.get("location")).toBe(
    `${origin}/auth-error?error=service_unavailable`,
  );
  await expect(
    browserAuthResponse(
      new Request(`${origin}/api/auth/oauth2/token`),
      async () => {
        throw new Error("failed");
      },
      origin,
    ),
  ).rejects.toThrow("failed");
});

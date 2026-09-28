import { auth } from "./auth.ts";
import { config } from "./config.ts";
import { AppError } from "./errors.ts";
import { type Actor, requireMember } from "./membership.ts";
export async function webActor(headers: Headers): Promise<Actor> {
  const session = await auth.api.getSession({ headers });
  if (!session)
    throw new AppError("UNAUTHENTICATED", "Sign in to continue.", 401);
  await requireMember(session.user.id);
  return { userId: session.user.id, transport: "web", scopes: [] };
}
export function requireSameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(config.APP_URL).origin)
    throw new AppError("FORBIDDEN", "Invalid request origin.", 403);
}
export async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError("INVALID_INPUT", "JSON request required.", 415);
  // Stream bound also protects chunked requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_INPUT", "Request body required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 32768) {
      await reader.cancel();
      throw new AppError("INVALID_INPUT", "Request too large.", 413);
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

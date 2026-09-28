import { listShares, shareLink } from "@/server/shares";
import { errorResponse, AppError } from "@/server/errors";
import { webActor, requireSameOrigin, readJson } from "@/server/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const q = Object.fromEntries(new URL(request.url).searchParams);
    return Response.json(
      await listShares(await webActor(request.headers), {
        ...q,
        ...(q.limit ? { limit: Number(q.limit) } : {}),
      }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await webActor(request.headers);
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "JSON object required.");
    const key = request.headers.get("idempotency-key");
    if (key && body.idempotency_key && key !== body.idempotency_key)
      throw new AppError("INVALID_INPUT", "Conflicting retry keys.");
    const result = await shareLink(actor, {
      ...body,
      ...(key ? { idempotency_key: key } : {}),
    });
    return Response.json(result, {
      status: result.replayed ? 200 : 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

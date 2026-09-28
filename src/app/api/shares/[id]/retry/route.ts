import { retryShare } from "@/server/shares";
import { webActor, requireSameOrigin, readJson } from "@/server/http";
import { errorResponse } from "@/server/errors";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    return Response.json(
      await retryShare(
        await webActor(request.headers),
        (await context.params).id,
        await readJson(request),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

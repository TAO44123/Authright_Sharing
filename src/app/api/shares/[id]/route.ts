import { getShare, withdrawShare } from "@/server/shares";
import { webActor, requireSameOrigin } from "@/server/http";
import { errorResponse } from "@/server/errors";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json(
      await getShare(await webActor(request.headers), (await params).id),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    return Response.json(
      await withdrawShare(
        await webActor(request.headers),
        (await context.params).id,
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

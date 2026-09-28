import { changeMember } from "@/server/admin-members";
import { webActor, requireSameOrigin, readJson } from "@/server/http";
import { errorResponse } from "@/server/errors";
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    return Response.json(
      await changeMember(
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

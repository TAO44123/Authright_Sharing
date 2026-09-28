import { setTimezone } from "@/server/account";
import { webActor, requireSameOrigin, readJson } from "@/server/http";
import { errorResponse } from "@/server/errors";
export async function PATCH(request: Request) {
  try {
    requireSameOrigin(request);
    return Response.json(
      await setTimezone(
        await webActor(request.headers),
        await readJson(request),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

import { listAdminMembers } from "@/server/admin-members";
import { webActor } from "@/server/http";
import { errorResponse } from "@/server/errors";
export async function GET(request: Request) {
  try {
    return Response.json(
      await listAdminMembers(
        await webActor(request.headers),
        Object.fromEntries(new URL(request.url).searchParams),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

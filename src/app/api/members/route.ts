import { listMembers } from "@/server/member-search";
import { webActor } from "@/server/http";
import { errorResponse } from "@/server/errors";
export async function GET(request: Request) {
  try {
    const q = Object.fromEntries(new URL(request.url).searchParams);
    return Response.json(
      await listMembers(await webActor(request.headers), {
        ...q,
        ...(q.limit ? { limit: Number(q.limit) } : {}),
      }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

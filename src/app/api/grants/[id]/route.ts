import { z } from "zod";
import { revokeGrant } from "@/server/membership";
import { webActor, requireSameOrigin } from "@/server/http";
import { errorResponse } from "@/server/errors";
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    await revokeGrant(
      await webActor(request.headers),
      z.uuid().parse((await params).id),
    );
    return new Response(null, { status: 204 });
  } catch (e) {
    return errorResponse(e);
  }
}

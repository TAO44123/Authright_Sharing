import { auth } from "@/server/auth";
import { config } from "@/server/config";
import { browserAuthResponse } from "@/server/browser-auth";
export const runtime = "nodejs";
const handle = (request: Request) =>
  browserAuthResponse(request, auth.handler, config.APP_URL);
export const GET = handle;
export const POST = handle;

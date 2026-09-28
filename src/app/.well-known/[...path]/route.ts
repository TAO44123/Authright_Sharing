import { auth } from "@/server/auth";
export const runtime = "nodejs";
export const GET = auth.handler;
export const HEAD = auth.handler;

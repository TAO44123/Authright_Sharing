import { sql } from "drizzle-orm";
import { db } from "@/server/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok", database: "reachable" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}

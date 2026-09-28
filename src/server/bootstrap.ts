import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db/index.ts";
import { members } from "./db/schema.ts";

export async function bootstrapAdmin(
  emailInput: string,
  workspaceDomain: string,
  database: typeof db = db,
) {
  const email = z.email().parse(emailInput.trim().toLowerCase());
  if (email.split("@")[1] !== workspaceDomain)
    throw new Error("Admin must belong to configured Workspace domain.");
  await database
    .insert(members)
    .values({ allowedEmail: email, role: "admin" })
    .onConflictDoNothing();
  const [member] = await database
    .select()
    .from(members)
    .where(eq(members.allowedEmail, email));
  if (member.role !== "admin")
    throw new Error("Existing member was not promoted. Review manually.");
  return member;
}

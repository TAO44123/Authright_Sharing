import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db/index.ts";
import { members } from "./db/schema.ts";
import { user } from "./db/auth-schema.ts";
import { requireMember, type Actor } from "./membership.ts";
import { displayName } from "./display-name.ts";
export const timezoneInput = z
  .object({
    timezone: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Use an IANA time zone."),
  })
  .strict();
export async function accountProfile(actor: Actor) {
  const member = await requireMember(actor.userId);
  const [profile] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, actor.userId));
  return {
    ...profile,
    name: displayName(profile.name, profile.email),
    role: member.role,
    timezone: member.timezone,
  };
}
export async function setTimezone(actor: Actor, input: unknown) {
  await requireMember(actor.userId);
  const value = timezoneInput.parse(input);
  await db
    .update(members)
    .set({ timezone: value.timezone, updatedAt: new Date() })
    .where(eq(members.userId, actor.userId));
  return value;
}

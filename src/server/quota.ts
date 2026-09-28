import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db/index.ts";
import { quotaReservations, settings, usageEvents } from "./db/schema.ts";
import type { SummaryPricing } from "./content/types.ts";
export function billingMonth(now = new Date()) {
  return `${now.toISOString().slice(0, 7)}-01`;
}
export async function reserveQuota(
  attemptId: string,
  database = db,
  now = new Date(),
  units = 1,
) {
  return database.transaction(async (tx) => {
    const [setting] = await tx
      .select()
      .from(settings)
      .where(eq(settings.id, 1))
      .for("update");
    const [old] = await tx
      .select()
      .from(quotaReservations)
      .where(eq(quotaReservations.attemptId, attemptId));
    if (old) return old.status !== "released";
    const month = billingMonth(now);
    const [{ count }] = await tx
      .select({
        count: sql<number>`coalesce(sum(${quotaReservations.units}), 0)::int`,
      })
      .from(quotaReservations)
      .where(
        and(
          eq(quotaReservations.billingMonth, month),
          inArray(quotaReservations.status, ["reserved", "consumed"]),
        ),
      );
    if (setting.quotaEnabled && count + units > setting.monthlyCallLimit!)
      return false;
    await tx
      .insert(quotaReservations)
      .values({ attemptId, billingMonth: month, units });
    return true;
  });
}
export async function recordInvocation(
  attemptId: string,
  model: string,
  database: Pick<typeof db, "update" | "insert"> = db,
  pricing?: SummaryPricing,
  invocationIndex = 1,
  service = "summary",
) {
  await database
    .update(quotaReservations)
    .set({ status: "consumed", updatedAt: new Date() })
    .where(eq(quotaReservations.attemptId, attemptId));
  await database
    .insert(usageEvents)
    .values({
      attemptId,
      service,
      invocationIndex,
      model,
      status: "started",
      priceVersion: pricing?.version,
      currency: pricing?.currency,
      inputPricePerMillion: pricing?.inputPerMillion,
      outputPricePerMillion: pricing?.outputPerMillion,
      pricedAt: pricing ? new Date() : undefined,
    })
    .onConflictDoNothing();
}

// Reserved capacity covers both video calls; release an unstarted second call.
export async function settleQuota(
  attemptId: string,
  database: Pick<typeof db, "update"> = db,
) {
  await database
    .update(quotaReservations)
    .set({
      units: sql`greatest(1, (select count(*) from usage_events where attempt_id = ${attemptId}))`,
      status: sql`case when exists (select 1 from usage_events where attempt_id = ${attemptId}) then 'consumed' else 'released' end`,
      updatedAt: new Date(),
    })
    .where(eq(quotaReservations.attemptId, attemptId));
}

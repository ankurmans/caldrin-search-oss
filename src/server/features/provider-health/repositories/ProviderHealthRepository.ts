import { and, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { providerHealthEvents } from "@/db/schema";

type NewEvent = Omit<typeof providerHealthEvents.$inferInsert, "id">;

async function insert(event: NewEvent) {
  await db.insert(providerHealthEvents).values({
    id: crypto.randomUUID(),
    ...event,
  });
}

async function lastCanaryAt() {
  const [row] = await db
    .select({ createdAt: providerHealthEvents.createdAt })
    .from(providerHealthEvents)
    .where(eq(providerHealthEvents.source, "canary"))
    .orderBy(desc(providerHealthEvents.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

async function recent(since: string, onlyFailures: boolean) {
  return db
    .select()
    .from(providerHealthEvents)
    .where(
      and(
        gte(providerHealthEvents.createdAt, since),
        onlyFailures ? eq(providerHealthEvents.ok, false) : undefined,
      ),
    )
    .orderBy(desc(providerHealthEvents.createdAt))
    .limit(200);
}

async function pruneBefore(cutoff: string) {
  await db
    .delete(providerHealthEvents)
    .where(lt(providerHealthEvents.createdAt, cutoff));
}

export const ProviderHealthRepository = {
  insert,
  lastCanaryAt,
  recent,
  pruneBefore,
};

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projectStorePlatforms } from "@/db/schema";

export type StorePlatform = typeof projectStorePlatforms.$inferSelect;

async function get(projectId: string): Promise<StorePlatform | null> {
  const [row] = await db
    .select()
    .from(projectStorePlatforms)
    .where(eq(projectStorePlatforms.projectId, projectId))
    .limit(1);
  return row ?? null;
}

// A re-check replaces the finding but keeps the person's manual choice.
async function saveDetection(input: {
  projectId: string;
  checkedDomain: string;
  detection: StorePlatform["detection"];
  evidence: string | null;
  checkedAt: string;
}): Promise<void> {
  const { projectId, ...finding } = input;
  await db
    .insert(projectStorePlatforms)
    .values({ projectId, ...finding })
    .onConflictDoUpdate({
      target: projectStorePlatforms.projectId,
      set: finding,
    });
}

async function setManualShopify(
  projectId: string,
  manualShopify: boolean,
): Promise<void> {
  await db
    .update(projectStorePlatforms)
    .set({ manualShopify })
    .where(eq(projectStorePlatforms.projectId, projectId));
}

export const StorePlatformRepository = {
  get,
  saveDetection,
  setManualShopify,
} as const;

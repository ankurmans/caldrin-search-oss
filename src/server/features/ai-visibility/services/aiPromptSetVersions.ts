import { AiPromptSetVersionRepository as repo } from "../repositories/aiPromptSetVersionRepository";

function sameSet(a: string[], b: string[]) {
  const members = new Set(a);
  return members.size === b.length && b.every((id) => members.has(id));
}

/**
 * The version describing exactly `promptIds`. A new version N+1 is written only
 * when that set differs from the tracker's latest version, so a rerun, a topic
 * edit or a pause that leaves the same prompts active keeps its version.
 * Rates are only comparable between runs of the same version.
 */
export async function ensurePromptSetVersion(
  trackerId: string,
  promptIds: string[],
): Promise<string> {
  const ids = [...new Set(promptIds)];
  // The unique (tracker, version) index rejects a concurrent writer's N+1; that
  // writer's version is then read, and wins when it holds the same set.
  for (let attempt = 0; attempt < 2; attempt++) {
    const latest = await repo.getLatestVersion(trackerId);
    if (latest && sameSet(await repo.listMemberIds(latest.id), ids))
      return latest.id;
    const next = {
      id: crypto.randomUUID(),
      trackerId,
      version: (latest?.version ?? 0) + 1,
      createdAt: new Date().toISOString(),
    };
    try {
      await repo.insertVersion(next, ids);
      return next.id;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  throw new Error("Prompt set version was not created.");
}

/** The version of the tracker's active (not paused, not archived) prompts. */
export async function ensureCurrentPromptSetVersion(
  trackerId: string,
): Promise<string> {
  return ensurePromptSetVersion(
    trackerId,
    await repo.listActivePromptIds(trackerId),
  );
}

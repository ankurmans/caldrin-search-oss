import type { createAiVisibilityTestDb } from "../aiVisibilityTestDb";
import { aiMatches, aiObservations, aiRuns, aiSources } from "@/db/schema";

const own = { name: "Caldrin Search", domain: "caldrin.co" };
const rival = { name: "Rival", domain: "rival.example" };
const projectId = "project";

export interface Answer {
  prompt: number;
  engine?: "chatgpt" | "gemini";
  status?: "completed" | "failed" | "pending";
  /** Null is a completed collection with no answer text. */
  text?: string | null;
  mentioned?: boolean;
  cited?: boolean;
  recommended?: boolean | null;
  rivalMentioned?: boolean;
  model?: string;
  sources?: string[];
}

let seq = 0;

export async function seedMeasurementRun(
  db: Awaited<ReturnType<typeof createAiVisibilityTestDb>>["db"],
  context: { trackerId: string; promptIds: string[]; versionId: string },
  answers: Answer[],
  options: {
    createdAt?: string;
    locationCode?: number;
    version?: string | null;
    project?: string;
    tracker?: string;
    prompts?: string[];
  } = {},
) {
  const id = `run-${++seq}`;
  const createdAt = options.createdAt ?? "2026-10-01T00:00:00.000Z";
  await db.insert(aiRuns).values({
    id,
    trackerId: options.tracker ?? context.trackerId,
    projectId: options.project ?? projectId,
    trigger: "manual",
    status: "completed",
    locationCode: options.locationCode ?? 2840,
    languageCode: "en",
    promptSetVersionId:
      options.version === undefined ? context.versionId : options.version,
    createdAt,
    completedAt: createdAt,
  });
  for (const answer of answers) {
    const observationId = `${id}-${seq++}`;
    const status = answer.status ?? "completed";
    await db.insert(aiObservations).values({
      id: observationId,
      runId: id,
      promptId: (options.prompts ?? context.promptIds)[answer.prompt],
      engine: answer.engine ?? "chatgpt",
      branded: false,
      status,
      model: answer.model ?? null,
      answerMarkdown:
        status === "completed" && answer.text !== null
          ? (answer.text ?? "An answer.")
          : null,
    });
    if (status !== "completed" || answer.text === null) continue;
    await db.insert(aiMatches).values([
      {
        id: `${observationId}-own`,
        observationId,
        ...own,
        own: true,
        mentioned: answer.mentioned ?? false,
        cited: answer.cited ?? false,
        recommended: answer.recommended ?? null,
      },
      {
        id: `${observationId}-rival`,
        observationId,
        ...rival,
        own: false,
        mentioned: answer.rivalMentioned ?? false,
        cited: false,
      },
    ]);
    for (const [position, url] of (answer.sources ?? []).entries())
      await db.insert(aiSources).values({
        id: `${observationId}-s${position}`,
        observationId,
        url,
        domain: new URL(url).hostname,
        position,
      });
  }
  return id;
}

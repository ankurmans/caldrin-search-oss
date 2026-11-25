import { and, asc, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  codingAgentPanels,
  codingAgentRuns,
  codingAgentSources,
} from "@/db/schema";

export const codingAgentRepository = {
  async latestPanel(projectId: string) {
    const [panel] = await db
      .select()
      .from(codingAgentPanels)
      .where(
        and(
          eq(codingAgentPanels.projectId, projectId),
          ne(codingAgentPanels.capturedAt, ""),
        ),
      )
      .orderBy(desc(codingAgentPanels.capturedAt), desc(codingAgentPanels.id))
      .limit(1);
    if (!panel) return null;

    const [runs, sources] = await Promise.all([
      db
        .select()
        .from(codingAgentRuns)
        .where(
          and(
            eq(codingAgentRuns.projectId, projectId),
            eq(codingAgentRuns.panelId, panel.id),
          ),
        )
        .orderBy(asc(codingAgentRuns.slot))
        .limit(3),
      db
        .select()
        .from(codingAgentSources)
        .where(
          and(
            eq(codingAgentSources.projectId, projectId),
            eq(codingAgentSources.panelId, panel.id),
          ),
        )
        .orderBy(asc(codingAgentSources.slot), asc(codingAgentSources.url))
        .limit(48),
    ]);
    return { panel, runs, sources };
  },
};

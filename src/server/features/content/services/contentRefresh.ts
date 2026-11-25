import { canQueueRefresh } from "@/shared/refreshQueue";
import { SpendLimitRefusal } from "@/server/features/spend/types";
import type { CustomerContext } from "@/server/lib/customer-context";
import { ContentRepository } from "../repositories/ContentRepository";
import { ContentRefusal } from "../rules/contentRefusal";
import { editDraft, startEditorialDraft } from "./editorialDrafts";
import { writeEditorialDraft } from "./writeEditorialDraft";

type Scope = CustomerContext & { projectId: string };

export async function writeOpportunityRefresh(
  scope: Scope,
  opportunityId: string,
  project: {
    domain: string | null;
    locationCode: number;
    languageCode: string;
  },
  resumeImported = false,
) {
  const opportunity = await ContentRepository.getOpportunity(
    scope.projectId,
    opportunityId,
  );
  const assetId = `refresh-${opportunityId}`;
  const existing = resumeImported
    ? await ContentRepository.getAsset(scope.projectId, assetId)
    : null;
  if (
    !opportunity?.pageUrl ||
    opportunity.status === "dismissed" ||
    (!existing && !canQueueRefresh(opportunity))
  )
    throw new ContentRefusal(
      "Choose an open opportunity for an existing page.",
    );
  if (existing && (existing.revision !== 1 || existing.status !== "draft"))
    return { assetId, written: true as const };

  const asset =
    existing ??
    (
      await startEditorialDraft(
        scope,
        { opportunityId, url: opportunity.pageUrl },
        assetId,
      )
    ).asset;
  try {
    const { draft } = await writeEditorialDraft(
      scope,
      {
        assetId: asset.id,
        expectedRevision: asset.revision,
        query: opportunity.query.trim().slice(0, 300),
        guidance:
          "Refresh the existing page. Preserve verified facts, relevant links and media. Use the brief to prioritize changes.",
        bodyHtml: asset.bodyHtml,
        searchWeb: false,
      },
      project,
    );
    await editDraft(scope, asset.id, draft, asset.revision);
    return { assetId: asset.id, written: true as const };
  } catch (error) {
    // The imported revision remains available for manual editing or retry.
    if (error instanceof ContentRefusal || error instanceof SpendLimitRefusal)
      return {
        assetId: asset.id,
        written: false as const,
        reason: error.message,
      };
    throw error;
  }
}

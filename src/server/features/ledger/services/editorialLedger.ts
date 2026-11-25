import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import { readEditorialFollowUp } from "./editorialFollowUp";
import { LedgerService } from "./LedgerService";

export async function getLedgerScreenDetail(
  projectId: string,
  entryId: string,
) {
  const detail = await LedgerService.getEntryWithNames(projectId, entryId);
  const { entry } = detail;
  const [finding, followUp] = await Promise.all([
    entry.opportunityId
      ? ContentRepository.getOpportunity(projectId, entry.opportunityId)
      : null,
    entry.contentAssetId ? readEditorialFollowUp(entry) : null,
  ]);
  return { ...detail, finding, followUp };
}

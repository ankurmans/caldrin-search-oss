import type { ProposeChangeInput } from "../types";
import { LedgerService } from "./LedgerService";
import { scopeA, seedAsset } from "./ledgerDb";

export {
  execSql,
  resetDatabase,
  scopeA,
  scopeB,
  seedAsset,
  seedMember,
  seedOpportunity,
  setAssetRevision,
  setEntryColumn,
} from "./ledgerDb";

export const proposal = (
  over: Partial<ProposeChangeInput> = {},
): ProposeChangeInput => ({
  kind: "content_article_create",
  provider: "shopify",
  proposedAction: "Publish article",
  contentAssetId: "asset-1",
  targetUrl: "https://shop.example/blogs/news/post",
  rollbackKind: "unpublish",
  ...over,
});

export async function propose(over: Partial<ProposeChangeInput> = {}) {
  seedAsset("project-a", "asset-1");
  return LedgerService.proposeChange(scopeA, proposal(over));
}

export async function approved(over: Partial<ProposeChangeInput> = {}) {
  const entry = await propose(over);
  return LedgerService.approveChange(scopeA, entry.id);
}

export async function executed(withRollback = true) {
  const entry = await approved();
  await LedgerService.beginExecution(scopeA, entry.id);
  return LedgerService.recordExecution(scopeA, entry.id, {
    externalId: "article-9",
    publicationStatus: "published",
    rollback: withRollback
      ? { kind: "unpublish", payload: "article-9" }
      : undefined,
  });
}

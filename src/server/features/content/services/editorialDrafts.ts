import { getStoredSerp } from "@/server/features/keywords/services/research/serp";
import { likelyPageType } from "@/server/features/site-explorer/rules/pageType";
import { fetchSourcePage } from "@/server/features/source-gap/sourcePageFetcher";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { ownsEditorialUrl } from "@/shared/editorialUrl";
import { importArticle } from "../rules/articleImport";
import type { StoreSnapshot } from "../rules/storeTypes";
import { AppError } from "@/server/lib/errors";
import { ContentRepository } from "../repositories/ContentRepository";
import { ContentRefusal } from "../rules/contentRefusal";
import { runQualityChecks } from "../rules/qualityChecks";
import { sanitizeHtml } from "../rules/sanitizeHtml";
import { storeFor, type Scope } from "./shopifyConnection";
import { listShopifyChanges } from "./shopifyChangePlan";

const EMPTY_STORE: StoreSnapshot = {
  shopName: "",
  products: [],
  collections: [],
  articles: [],
};

async function draftingStore(projectId: string) {
  const connection = await ContentRepository.getConnection(projectId);
  return connection ? (await storeFor(connection)).readSnapshot() : EMPTY_STORE;
}

export async function startEditorialDraft(
  scope: Scope,
  input: { opportunityId?: string; url?: string; title?: string },
  reservedId?: string,
) {
  const opportunity = input.opportunityId
    ? await ContentRepository.getOpportunity(
        scope.projectId,
        input.opportunityId,
      )
    : null;
  if (input.opportunityId && !opportunity)
    throw new AppError("NOT_FOUND", "Opportunity not found.");
  const url = input.url;
  let importedFrom: string | undefined;
  let importWarning: string | undefined;
  let bodyHtml = "<p></p>";
  let title =
    input.title?.trim() || opportunity?.query.slice(0, 200) || "Untitled draft";

  if (url) {
    const project = await ProjectRepository.getProjectById(scope.projectId);
    if (!ownsEditorialUrl(project?.domain, url))
      throw new ContentRefusal("Use a page on this project's website.");
    const page = await fetchSourcePage(url, { allowHomepage: true });
    if (page.status !== "ok" || !page.html)
      throw new ContentRefusal(
        page.note ??
          "Could not read this page. Paste its content into a blank draft.",
      );
    if (!ownsEditorialUrl(project?.domain, page.finalUrl))
      throw new ContentRefusal(
        "The page redirected outside this project's website.",
      );
    const article = importArticle(page.html, page.finalUrl);
    if (!article.bodyHtml || article.bodyHtml.length > 100_000)
      throw new ContentRefusal(
        "The page could not be imported as a single article. Paste the section you want to edit.",
      );
    title = article.title || title;
    bodyHtml = article.bodyHtml;
    importedFrom = page.finalUrl;
    if (article.formattingWarning)
      importWarning =
        "Review the imported copy. Layout, embedded media and some formatting may have been removed.";
  }

  const draft = {
    title,
    bodyHtml,
    metaTitle: title.slice(0, 120),
    metaDescription: "",
  };
  const asset = await ContentRepository.createAsset({
    id: reservedId,
    ...draft,
    projectId: scope.projectId,
    organizationId: scope.organizationId,
    opportunityId: opportunity?.id ?? null,
    importedFrom,
    importWarning,
    searchIntent: opportunity?.query ?? "",
    briefMarkdown: opportunity?.reason ?? "",
    generator: "template",
    createdByUserId: scope.userId,
    references: [],
  });
  await ContentRepository.replaceQualityChecks(
    asset.id,
    asset.revision,
    runQualityChecks(draft, EMPTY_STORE, false),
  );
  if (opportunity)
    await ContentRepository.setOpportunityStatus(
      scope.projectId,
      opportunity.id,
      "briefed",
    );
  return getAssetDetail(scope.projectId, asset.id);
}

export async function getAssetDetail(projectId: string, assetId: string) {
  const asset = await ContentRepository.getAsset(projectId, assetId);
  if (!asset) throw new AppError("NOT_FOUND", "Draft not found.");
  const [
    checks,
    references,
    publications,
    versions,
    changes,
    connection,
    opportunity,
    evidence,
    project,
  ] = await Promise.all([
    ContentRepository.listQualityChecks(asset.id, asset.revision),
    ContentRepository.listReferences(asset.id),
    ContentRepository.listPublications(asset.id),
    ContentRepository.listVersions(asset.id),
    listShopifyChanges(projectId, asset.id),
    ContentRepository.getConnection(projectId),
    asset.opportunityId
      ? ContentRepository.getOpportunity(projectId, asset.opportunityId)
      : null,
    asset.opportunityId
      ? ContentRepository.listOpportunityEvidence(
          projectId,
          asset.opportunityId,
        )
      : [],
    ProjectRepository.getProjectById(projectId),
  ]);
  const savedAnswer = evidence.find(
    (item) => item.label === "Saved answer" && item.url?.startsWith("/p/"),
  );
  const savedFilters = new URLSearchParams(savedAnswer?.url?.split("?")[1]);
  const location = Number(savedFilters.get("locationCode"));
  const language = savedFilters.get("languageCode");
  const market =
    location > 0 && language
      ? { locationCode: location, languageCode: language }
      : project
        ? {
            locationCode: project.locationCode,
            languageCode: project.languageCode,
          }
        : null;
  const target = asset.importedFrom ?? opportunity?.pageUrl ?? null;
  const targetType = likelyPageType(target);
  const sameIntent =
    market && opportunity?.query && targetType
      ? await getStoredSerp(
          { projectId, keyword: opportunity.query, ...market },
          asset,
          true,
        )
      : null;
  const benchmarks = (sameIntent?.items ?? [])
    .filter(
      (item) =>
        item.url !== target &&
        likelyPageType(item.url) === targetType &&
        /^https?:\/\//i.test(item.url),
    )
    .slice(0, 5)
    .map((item) => ({
      url: item.url,
      title: item.title,
      rank: item.rank,
      fetchedAt: sameIntent?.fetchedAt ?? null,
    }));
  return {
    asset,
    checks,
    references,
    publications,
    versions,
    changes,
    canPublish: Boolean(connection?.canPublish),
    opportunity,
    evidence,
    market,
    benchmarks,
    domain: project?.domain ?? null,
  };
}

export async function editDraft(
  scope: Scope,
  assetId: string,
  fields: {
    title: string;
    bodyHtml: string;
    metaTitle: string;
    metaDescription: string;
  },
  expectedRevision?: number,
) {
  const current = await ContentRepository.getAsset(scope.projectId, assetId);
  if (!current) throw new AppError("NOT_FOUND", "Draft not found.");
  if (current.status === "published") {
    throw new ContentRefusal(
      "A published revision cannot be edited. Create a new revision from the store.",
    );
  }
  if (expectedRevision !== undefined && current.revision !== expectedRevision)
    throw new ContentRefusal(
      "This draft changed while you were editing. Copy your work and reopen the latest revision.",
    );
  const store = await draftingStore(scope.projectId);
  const clean = { ...fields, bodyHtml: sanitizeHtml(fields.bodyHtml) };
  const updated = await ContentRepository.updateAssetContent(
    scope.projectId,
    assetId,
    scope.userId,
    clean,
    current.revision,
  );
  if (!updated)
    throw new ContentRefusal(
      "This draft changed while you were editing. Copy your work and reopen the latest revision.",
    );
  await ContentRepository.replaceQualityChecks(
    updated.id,
    updated.revision,
    runQualityChecks(clean, store, store !== EMPTY_STORE),
  );
  return getAssetDetail(scope.projectId, assetId);
}

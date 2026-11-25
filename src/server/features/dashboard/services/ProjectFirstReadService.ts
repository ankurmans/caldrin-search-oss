import { captureServerEvent } from "@/server/lib/posthog";
import { runAfterResponse } from "@/server/lib/background";
import type { ProjectFirstRead } from "@/shared/first-read";
import { DomainService } from "@/server/features/domain/services/DomainService";
import { GscService } from "@/server/features/gsc/services/GscService";
import { getWorkspaceMode } from "@/server/features/workspace/credentials";
import { buildCacheKey } from "@/server/lib/r2-cache";
import type {
  EnsuredUserContext,
  EnsuredProject,
} from "@/middleware/ensure-user/types";
import { DataRefreshClaimRepository } from "../repositories/DataRefreshClaimRepository";
import { ProjectFirstReadRepository } from "../repositories/ProjectFirstReadRepository";
import {
  readAiSample,
  readCompetitor,
  readCrawlSample,
  readSearchConsole,
} from "./firstReadSources";

const COMPLETED_DELAY = 365 * 86_400_000;
const FAILED_DELAY = 30_000;

async function collect(
  project: EnsuredProject & { domain: string },
  context: EnsuredUserContext,
  siteUrl: string | null,
  key: string,
) {
  const scope = {
    projectId: project.id,
    domain: project.domain,
    locationCode: project.locationCode,
    languageCode: project.languageCode,
  };
  const customer = { ...context, projectId: project.id };
  const [overview, search, mode] = await Promise.all([
    DomainService.getStoredOverview(scope, customer).catch(() => null),
    siteUrl ? readSearchConsole(scope, siteUrl).catch(() => null) : null,
    getWorkspaceMode(context.organizationId),
  ]);
  const allowTrialSpend = mode === "trial" && context.emailVerified;
  const overviewFinding = overview?.organicKeywords
    ? {
        kind: "organic_keywords" as const,
        subject: scope.domain,
        metric: overview.organicKeywords,
        observedAt: overview.fetchedAt,
      }
    : null;
  const [crawl, ai, competitor] = await Promise.all([
    siteUrl
      ? readCrawlSample(
          scope.domain,
          search?.queries.map((item) => item.page) ?? [],
        ).catch(() => null)
      : null,
    search && allowTrialSpend
      ? readAiSample(
          scope,
          search.queries.map((item) => item.query),
          customer,
          project.brandName ?? project.name,
        ).catch(() => [])
      : [],
    !siteUrl || (!search?.queries.length && !overviewFinding)
      ? readCompetitor(scope, customer, allowTrialSpend).catch(() => null)
      : null,
  ]);
  const findings = [
    search?.finding,
    crawl?.kind === "missing_titles" ? crawl : null,
    ...ai,
    overviewFinding,
    competitor,
    crawl?.kind === "titles_found" ? crawl : null,
  ]
    .filter((finding) => finding != null)
    .slice(0, 5);

  const saved = await ProjectFirstReadRepository.save(
    {
      key,
      projectId: project.id,
      completedAt: new Date().toISOString(),
      searchConsole: !siteUrl
        ? "skipped"
        : !search
          ? "unavailable"
          : search.queries.length
            ? "read"
            : "no_history",
    },
    findings,
  );
  if (saved && ai.length) {
    await runAfterResponse(
      captureServerEvent({
        distinctId: context.userId,
        organizationId: context.organizationId,
        event: "onboarding:tracker_or_baseline_created",
        properties: { project_id: project.id, kind: "ai_baseline" },
      }),
    );
  }
  return saved;
}

async function get(
  project: EnsuredProject,
  context: EnsuredUserContext,
): Promise<ProjectFirstRead> {
  if (!project.domain) return { status: "no_site" };
  const connection = await GscService.getConnection(project.id);
  const siteUrl = connection?.siteUrl ?? null;
  const key = await buildCacheKey("dashboard:first-read", {
    projectId: project.id,
    domain: project.domain,
    market: [project.locationCode, project.languageCode],
    siteUrl,
    connectionId: connection?.gscAccountId ?? null,
    connectedAt: connection?.updatedAt ?? null,
  });
  const saved = await ProjectFirstReadRepository.get(key);
  if (saved) return { status: "ready", ...saved };
  const token = await DataRefreshClaimRepository.claim(
    key,
    project.organizationId,
  );
  if (!token) return { status: "pending" };
  try {
    const read =
      (await ProjectFirstReadRepository.get(key)) ??
      (await collect(
        { ...project, domain: project.domain },
        context,
        siteUrl,
        key,
      ));
    if (!read) throw new Error("First read could not be saved");
    await DataRefreshClaimRepository.finish(key, token, COMPLETED_DELAY);
    return { status: "ready", ...read };
  } catch (error) {
    await DataRefreshClaimRepository.finish(key, token, FAILED_DELAY);
    throw error;
  }
}

export const ProjectFirstReadService = { get };

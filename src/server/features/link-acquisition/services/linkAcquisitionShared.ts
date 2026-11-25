import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import { getWorkspaceMode } from "@/server/features/workspace/credentials";
import { KeywordGapRepository } from "@/server/features/site-explorer/repositories/KeywordGapRepository";
import { normaliseDomain } from "@/server/features/site-explorer/rules/gapMerge";
import type { ExplorerContext } from "@/server/features/site-explorer/services/KeywordGapExplorerService";
import { hasDataforseoAccess } from "@/server/lib/provider-access";
import { LINK_GAP_MAX_COMPETITORS } from "@/shared/link-acquisition";

export type LinkAcquisitionContext = ExplorerContext;

export const usd = (n: number) => `$${n.toFixed(2)}`;

export async function accessRefusal(
  organizationId: string,
): Promise<string | null> {
  if (await hasDataforseoAccess()) return null;
  return (await getWorkspaceMode(organizationId)) === "byok"
    ? "This workspace uses its own provider keys and has no DataForSEO key saved. Add one in Settings to read backlinks."
    : "DataForSEO is not set up for this workspace, so backlinks cannot be read.";
}

/**
 * The project's own domain and the competitors to compare, from the request or
 * the saved list. Own domain is never a competitor. Nothing here calls the
 * provider.
 */
export async function resolveTargets(
  ctx: LinkAcquisitionContext,
  requested: string[],
) {
  const [project, saved] = await Promise.all([
    OpportunityRepository.getProjectBrand(ctx.projectId),
    KeywordGapRepository.listCompetitorsWithMarkets(ctx.projectId),
  ]);
  const own = project?.domain ? normaliseDomain(project.domain) : null;
  const parsed = requested.map((raw) => ({
    raw,
    domain: normaliseDomain(raw),
  }));
  const invalid = parsed.find((entry) => entry.domain === null)?.raw ?? null;
  const pool =
    parsed.length > 0
      ? parsed.map((entry) => entry.domain)
      : saved.map((competitor) => competitor.domain);
  const competitors = [
    ...new Set(
      pool.filter((domain): domain is string => !!domain && domain !== own),
    ),
  ];
  return {
    own,
    competitors: competitors.slice(0, LINK_GAP_MAX_COMPETITORS),
    tooMany: competitors.length > LINK_GAP_MAX_COMPETITORS,
    invalid,
    projectLanguage: project?.languageCode ?? null,
  };
}

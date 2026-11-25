import { SourceIntelligenceRepository as repo } from "../repositories/SourceIntelligenceRepository";
import {
  SourcePageAnalysisRepository,
  type StoredAnalysis,
} from "../repositories/SourcePageAnalysisRepository";
import { suggestApproach } from "../rules/sourcePageRules";

export type SourcePageAnalysis = StoredAnalysis & {
  approach: ReturnType<typeof suggestApproach>;
  competitorDomain: boolean;
};

async function withApproach(
  projectId: string,
  stored: StoredAnalysis,
): Promise<SourcePageAnalysis> {
  const brands = await repo.brands(projectId);
  const host = new URL(stored.url).hostname.replace(/^www\./, "");
  const competitorDomain = brands.some(
    (b) => !b.own && (host === b.domain || host.endsWith(`.${b.domain}`)),
  );
  return {
    ...stored,
    competitorDomain,
    approach: suggestApproach({
      pageKind: stored.pageKind,
      competitorDomain,
      namesBrand: stored.namesBrand,
    }),
  };
}

/** The stored reading of a page, if there is one. Reads only our own data. */
export async function loadSourceAnalysis(
  projectId: string,
  url: string,
): Promise<SourcePageAnalysis | null> {
  const stored = await SourcePageAnalysisRepository.get(projectId, url);
  return stored ? withApproach(projectId, stored) : null;
}

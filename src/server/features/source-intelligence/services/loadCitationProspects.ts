import { sort } from "remeda";
import type { SourceFilters } from "@/types/schemas/source-intelligence";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { competitorCitations } from "../repositories/CitationProspectsRepository";
import { SourceIntelligenceRepository as repo } from "../repositories/SourceIntelligenceRepository";
import { mergeCounts } from "../rules/sourceRules";

export async function loadCitationProspects(
  projectId: string,
  filters: SourceFilters,
) {
  const [cited, matched, brands, project, decisions] = await Promise.all([
    repo.citedCounts(projectId, filters, "url"),
    competitorCitations(projectId, filters),
    repo.brands(projectId),
    ProjectRepository.getProjectById(projectId),
    repo.listDecisions(projectId),
  ]);
  const projectBrand = project?.domain
    ? [{ domain: project.domain, name: project.name, own: true }]
    : [];
  const citedRows = mergeCounts(cited, [], [...projectBrand, ...brands]);
  const byDomain = new Map(decisions.map((row) => [row.domain, row.decision]));
  const competitors = new Map<string, typeof matched>();
  for (const row of matched) {
    const current = competitors.get(row.url) ?? [];
    current.push(row);
    competitors.set(row.url, current);
  }

  return sort(
    citedRows.flatMap((row) => {
      const matching = competitors.get(row.key);
      const decision = byDomain.get(row.domain) ?? null;
      if (
        !matching?.length ||
        row.brand ||
        row.citedAnswers < 2 ||
        (filters.hideDismissed && decision === "dismiss")
      )
        return [];
      return [
        {
          ...row,
          decision,
          competitors: matching.map(({ name, domain, answers }) => ({
            name: name ?? domain,
            domain,
            answers,
          })),
        },
      ];
    }),
    (a, b) => b.citedAnswers - a.citedAnswers || a.key.localeCompare(b.key),
  ).slice(0, 15);
}

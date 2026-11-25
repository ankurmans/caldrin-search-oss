import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, GitCompare, Link2, Plus, Sparkles } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import {
  projectContextQueryKey,
  useContextUpdate,
} from "@/client/features/projects/project-context/shared";
import { getProjectContext } from "@/serverFunctions/projectContext";

const bare = (domain: string) => domain.replace(/^www\./i, "").toLowerCase();

/**
 * What to do with the domain being explored: keep a research domain as a
 * project competitor, or open its full backlink profile or its place in AI
 * answers. None of these start a provider lookup; the other pages run their
 * own search once opened.
 */
export function SiteExplorerActions({
  projectId,
  domain,
  isOwn,
}: {
  projectId: string;
  domain: string;
  /** The project's own site is not a competitor, so it gets no save or gap. */
  isOwn: boolean;
}) {
  const context = useQuery({
    queryKey: projectContextQueryKey(projectId),
    queryFn: () => getProjectContext({ data: { projectId } }),
    staleTime: 60_000,
  });
  const update = useContextUpdate(projectId);
  const navigate = useNavigate();
  const saved =
    context.data?.competitors.some(
      (competitor) => bare(competitor.domain) === bare(domain),
    ) ?? false;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isOwn ? null : (
        <>
          {saved ? (
            <Button variant="outline" size="sm" disabled>
              <Check /> Saved as competitor
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={context.data === undefined || update.isPending}
              onClick={() => update.mutate([{ addCompetitors: [{ domain }] }])}
            >
              <Plus /> Save as competitor
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={context.data === undefined || update.isPending}
            onClick={() => {
              const open = () =>
                void navigate({
                  to: "/p/$projectId/keyword-gap",
                  params: { projectId },
                });
              if (saved) open();
              else
                update.mutate([{ addCompetitors: [{ domain }] }], {
                  onSuccess: open,
                });
            }}
          >
            <GitCompare /> Keyword gap
          </Button>
        </>
      )}
      <Button
        variant="outline"
        size="sm"
        render={
          <Link
            to="/p/$projectId/backlinks"
            params={{ projectId }}
            search={{ target: domain }}
          />
        }
      >
        <Link2 /> Full backlink profile
      </Button>
      <Button
        variant="outline"
        size="sm"
        render={
          <Link
            to="/p/$projectId/brand-lookup"
            params={{ projectId }}
            search={{ q: domain }}
          />
        }
      >
        <Sparkles /> Brand in AI answers
      </Button>
    </div>
  );
}

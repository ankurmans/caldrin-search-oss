import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BacklinksPage } from "@/client/features/backlinks/BacklinksPage";
import {
  DEFAULT_BACKLINKS_PAGE_SIZE,
  backlinksSearchSchema,
} from "@/types/schemas/backlinks";
import { defaultScopeForInput } from "@/shared/researchScope";
import { useProjectMarket } from "@/client/features/projects/useProjectMarket";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute("/_app/p/$projectId/backlinks")({
  head: () => pageHead("Backlinks"),
  validateSearch: backlinksSearchSchema,
  component: BacklinksRoute,
});

function BacklinksRoute() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const {
    ws: workspace = "profile",
    target: rawTarget,
    scope: rawScope,
    tab = "backlinks",
    page = 1,
    size = DEFAULT_BACKLINKS_PAGE_SIZE,
    sort,
    order,
    view,
    includeSpam,
  } = Route.useSearch();
  // Opens on the project's own site. An empty target is the recent-searches view.
  const project = useProjectMarket(projectId);
  const target = rawTarget ?? project?.domain ?? "";
  const scope = rawScope ?? defaultScopeForInput(target);

  return (
    <BacklinksPage
      projectId={projectId}
      navigate={navigate}
      searchState={{
        workspace,
        target,
        scope,
        // Referring domains can't be filtered to a subfolder.
        tab: scope === "subfolder" && tab === "domains" ? "backlinks" : tab,
        page,
        pageSize: size,
        sort,
        order,
        view,
        includeSpam,
      }}
    />
  );
}

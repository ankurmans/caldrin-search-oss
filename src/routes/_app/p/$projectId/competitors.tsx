import { createFileRoute } from "@tanstack/react-router";
import { CompetitorsPage } from "@/client/features/site-explorer/CompetitorsPage";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute("/_app/p/$projectId/competitors")({
  head: () => pageHead("Competitors"),
  component: CompetitorsRoute,
});

function CompetitorsRoute() {
  const { projectId } = Route.useParams();
  return <CompetitorsPage projectId={projectId} />;
}

import { createFileRoute } from "@tanstack/react-router";
import { InsightsPage } from "@/client/features/ai-visibility/insights/InsightsPage";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute(
  "/_app/p/$projectId/ai-visibility/insights",
)({
  head: () => pageHead("AI Search"),
  component: InsightsRoute,
});

function InsightsRoute() {
  const { projectId } = Route.useParams();
  return <InsightsPage key={projectId} projectId={projectId} />;
}

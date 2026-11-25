import { createFileRoute } from "@tanstack/react-router";
import { PerceptionPage } from "@/client/features/ai-perception/PerceptionPage";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute(
  "/_app/p/$projectId/ai-visibility/perception",
)({
  head: () => pageHead("Brand perception"),
  component: PerceptionRoute,
});

function PerceptionRoute() {
  const { projectId } = Route.useParams();
  return <PerceptionPage key={projectId} projectId={projectId} />;
}

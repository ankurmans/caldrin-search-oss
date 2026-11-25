import { createFileRoute } from "@tanstack/react-router";
import { AiCrawlersPage } from "@/client/features/ai-crawlers/AiCrawlersPage";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute(
  "/_app/p/$projectId/technical/ai-crawlers",
)({
  head: () => pageHead("AI crawlers"),
  component: AiCrawlersRoute,
});

function AiCrawlersRoute() {
  const { projectId } = Route.useParams();
  return <AiCrawlersPage key={projectId} projectId={projectId} />;
}

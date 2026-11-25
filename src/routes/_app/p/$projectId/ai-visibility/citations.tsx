import { createFileRoute } from "@tanstack/react-router";
import { CitationGapsPage } from "@/client/features/citation-gaps/CitationGapsPage";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute(
  "/_app/p/$projectId/ai-visibility/citations",
)({
  head: () => pageHead("Citation Gaps"),
  component: CitationGapsRoute,
});

function CitationGapsRoute() {
  const { projectId } = Route.useParams();
  return <CitationGapsPage key={projectId} projectId={projectId} />;
}

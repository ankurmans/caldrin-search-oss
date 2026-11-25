import { createFileRoute } from "@tanstack/react-router";
import { BrandFactsPage } from "@/client/features/ai-fact-checks/BrandFactsPage";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute("/_app/p/$projectId/ai-visibility/facts")({
  head: () => pageHead("Brand facts"),
  component: BrandFactsRoute,
});

function BrandFactsRoute() {
  const { projectId } = Route.useParams();
  return <BrandFactsPage key={projectId} projectId={projectId} />;
}

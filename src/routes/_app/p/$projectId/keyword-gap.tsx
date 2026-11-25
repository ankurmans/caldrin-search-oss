import { createFileRoute } from "@tanstack/react-router";
import { KeywordGapPage } from "@/client/features/site-explorer/KeywordGapPage";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute("/_app/p/$projectId/keyword-gap")({
  head: () => pageHead("Keyword gap"),
  component: KeywordGapRoute,
});

function KeywordGapRoute() {
  const { projectId } = Route.useParams();
  return <KeywordGapPage projectId={projectId} />;
}

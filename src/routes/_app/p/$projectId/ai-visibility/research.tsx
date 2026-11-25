import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PromptResearchPage } from "@/client/features/ai-visibility/PromptResearchPage";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute(
  "/_app/p/$projectId/ai-visibility/research",
)({
  head: () => pageHead("Prompt Research"),
  validateSearch: z.object({ q: z.string().trim().max(100).optional() }),
  component: AiResearchRoute,
});

function AiResearchRoute() {
  const { projectId } = Route.useParams();
  const { q } = Route.useSearch();
  return (
    <PromptResearchPage key={projectId} projectId={projectId} keyword={q} />
  );
}

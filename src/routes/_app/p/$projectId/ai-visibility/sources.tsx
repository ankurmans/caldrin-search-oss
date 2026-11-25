import { createFileRoute } from "@tanstack/react-router";
import { SourceIntelligencePage } from "@/client/features/source-intelligence/SourceIntelligencePage";
import { pageHead } from "@/client/lib/pageHead";

import { sourceSearchSchema } from "@/types/schemas/source-intelligence";

export const Route = createFileRoute(
  "/_app/p/$projectId/ai-visibility/sources",
)({
  head: () => pageHead("Source Intelligence"),
  validateSearch: sourceSearchSchema,
  component: SourceIntelligenceRoute,
});

function SourceIntelligenceRoute() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SourceIntelligencePage
      key={projectId}
      projectId={projectId}
      search={search}
      onSearch={(next) => void navigate({ search: next })}
    />
  );
}

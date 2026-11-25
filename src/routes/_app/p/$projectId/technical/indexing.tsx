import { createFileRoute } from "@tanstack/react-router";
import { IndexNowSettings } from "@/client/features/settings/IndexNowSettings";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute("/_app/p/$projectId/technical/indexing")({
  head: () => pageHead("Indexing"),
  component: IndexingRoute,
});

function IndexingRoute() {
  const { projectId } = Route.useParams();
  return (
    <div className="px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl">
        <IndexNowSettings projectId={projectId} />
      </div>
    </div>
  );
}

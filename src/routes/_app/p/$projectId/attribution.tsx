import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AttributionPage } from "@/client/features/attribution/AttributionPage";
import { pageHead } from "@/client/lib/pageHead";
import { attributionPageSearchSchema } from "@/types/schemas/attribution";

export const Route = createFileRoute("/_app/p/$projectId/attribution")({
  head: () => pageHead("Revenue Intelligence"),
  validateSearch: attributionPageSearchSchema,
  component: AttributionRoute,
});

function AttributionRoute() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  return (
    <AttributionPage
      projectId={projectId}
      search={search}
      onSearchChange={(update) => {
        void navigate({
          search: (prev) => ({ ...prev, ...update }),
          replace: true,
        });
      }}
    />
  );
}

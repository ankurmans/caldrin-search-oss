import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { OpportunitiesPage } from "@/client/features/opportunities/OpportunitiesPage";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute("/_app/p/$projectId/opportunities")({
  head: () => pageHead("Opportunities"),
  // Opens that opportunity's evidence, so other pages can link to a record.
  validateSearch: z.object({
    opportunity: z.string().min(1).optional().catch(undefined),
  }),
  component: OpportunitiesPageRoute,
});

function OpportunitiesPageRoute() {
  const { projectId } = Route.useParams();
  const { opportunity } = Route.useSearch();
  return (
    <OpportunitiesPage projectId={projectId} initialOpenId={opportunity} />
  );
}

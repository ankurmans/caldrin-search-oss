import { createFileRoute, notFound } from "@tanstack/react-router";
import { ClaimIntelligencePage } from "@/client/features/ai-claims/ClaimIntelligencePage";
import { pageHead } from "@/client/lib/pageHead";
import { getClaimsAvailability } from "@/serverFunctions/ai-claims";

export const Route = createFileRoute("/_app/p/$projectId/ai-visibility/claims")(
  {
    head: () => pageHead("Claim Intelligence"),
    loader: async ({ params }) => {
      if (
        !(await getClaimsAvailability({
          data: { projectId: params.projectId },
        }))
      )
        throw notFound();
    },
    component: ClaimsRoute,
  },
);

function ClaimsRoute() {
  const { projectId } = Route.useParams();
  return <ClaimIntelligencePage key={projectId} projectId={projectId} />;
}

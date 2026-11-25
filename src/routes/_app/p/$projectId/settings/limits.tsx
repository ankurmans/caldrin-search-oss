import { createFileRoute } from "@tanstack/react-router";
import { SpendCard } from "@/client/features/ledger/SpendCard";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute("/_app/p/$projectId/settings/limits")({
  head: () => pageHead("Usage & Limits"),
  component: ProjectLimitsRoute,
});

function ProjectLimitsRoute() {
  const { projectId } = Route.useParams();
  return <SpendCard projectId={projectId} />;
}

import { createFileRoute } from "@tanstack/react-router";
import { AlertsPanel } from "@/client/features/monitoring/AlertsPanel";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute("/_app/p/$projectId/alerts")({
  head: () => pageHead("Alerts"),
  component: AlertsPageRoute,
});

function AlertsPageRoute() {
  const { projectId } = Route.useParams();
  return <AlertsPanel projectId={projectId} />;
}

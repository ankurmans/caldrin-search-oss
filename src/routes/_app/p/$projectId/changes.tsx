import { z } from "zod";
import { createFileRoute } from "@tanstack/react-router";
import { ChangeLedgerPage } from "@/client/features/ledger/ChangeLedgerPage";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute("/_app/p/$projectId/changes")({
  head: () => pageHead("Workflows & Changes"),
  validateSearch: z.object({ change: z.string().optional().catch(undefined) }),
  component: ChangeLedgerPageRoute,
});

function ChangeLedgerPageRoute() {
  const { projectId } = Route.useParams();
  const { change } = Route.useSearch();
  return (
    <ChangeLedgerPage
      key={`${projectId}:${change ?? ""}`}
      projectId={projectId}
      initialChange={change}
    />
  );
}

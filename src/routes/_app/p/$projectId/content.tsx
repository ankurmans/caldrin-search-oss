import { z } from "zod";
import { createFileRoute } from "@tanstack/react-router";
import { ContentPage } from "@/client/features/content/ContentPage";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute("/_app/p/$projectId/content")({
  head: () => pageHead("Content Studio"),
  validateSearch: z.object({
    opportunity: z.string().optional(),
    draft: z.string().optional(),
    revision: z.number().int().positive().optional().catch(undefined),
  }),
  component: ContentRoute,
});

function ContentRoute() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  return (
    <ContentPage
      key={`${projectId}:${search.opportunity ?? ""}:${search.draft ?? ""}:${search.revision ?? ""}`}
      projectId={projectId}
      initialOpportunity={search.opportunity}
      initialDraft={search.draft}
      initialRevision={search.revision}
    />
  );
}

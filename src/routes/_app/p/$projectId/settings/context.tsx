import { createFileRoute } from "@tanstack/react-router";
import { ProjectContextPage } from "@/client/features/projects/project-context/ProjectContextPage";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute("/_app/p/$projectId/settings/context")({
  head: () => pageHead("Context"),
  component: ProjectContextSettingsRoute,
});

function ProjectContextSettingsRoute() {
  const { projectId } = Route.useParams();
  return <ProjectContextPage projectId={projectId} />;
}

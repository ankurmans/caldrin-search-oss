import { useQuery } from "@tanstack/react-query";
import { projectsQueryOptions } from "@/client/features/projects/projectQueries";
import type { ProjectSummary } from "./types";

/** The project, or undefined until the projects query resolves. */
export function useProjectMarket(
  projectId: string,
): ProjectSummary | undefined {
  const projectsQuery = useQuery(projectsQueryOptions());

  return projectsQuery.data?.find((project) => project.id === projectId);
}

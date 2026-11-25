import * as React from "react";
import { projectsQueryOptions } from "@/client/features/projects/projectQueries";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, GripVertical, Plus, Star } from "lucide-react";
import { toast } from "sonner";
import {
  deleteArchivedProject,
  getArchivedProjects,
  organizeProjects,
  restoreProject,
} from "@/serverFunctions/projects";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { PageHeader, SectionHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { getLastProjectId } from "@/client/lib/active-project";
import { CreateProjectModal } from "@/client/features/projects/CreateProjectModal";
import { pageHead } from "@/client/lib/pageHead";
import { toOrganizeItems } from "@/client/features/projects/projectLayout";
import type { ProjectSummary } from "@/client/features/projects/types";

export const Route = createFileRoute("/_app/projects")({
  head: () => pageHead("Projects"),
  component: ProjectsPage,
});

function ProjectsPage() {
  const [creating, setCreating] = React.useState(false);
  // Read after mount to keep SSR/first render stable.
  const [currentProjectId, setCurrentProjectId] = React.useState<string | null>(
    null,
  );
  React.useEffect(() => {
    setCurrentProjectId(getLastProjectId());
  }, []);
  const projectsQuery = useQuery(projectsQueryOptions());

  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          title="Projects"
          description="Each project has its own Search Console, rank tracking, and audits."
          actions={
            <Button onClick={() => setCreating(true)}>
              <Plus data-icon="inline-start" />
              New project
            </Button>
          }
        />

        <QueryState
          query={projectsQuery}
          errorFallback="Failed to load projects"
        >
          {(data) => (
            <ProjectList projects={data} currentProjectId={currentProjectId} />
          )}
        </QueryState>

        <ArchivedProjects />
      </div>

      {creating ? (
        <CreateProjectModal onClose={() => setCreating(false)} />
      ) : null}
    </div>
  );
}

function ProjectList({
  projects,
  currentProjectId,
}: {
  projects: ProjectSummary[];
  currentProjectId: string | null;
}) {
  const queryClient = useQueryClient();
  const [dragId, setDragId] = React.useState<string | null>(null);
  const groups = [
    ...new Set(
      projects.flatMap((project) =>
        project.groupName ? [project.groupName] : [],
      ),
    ),
  ];

  const save = useMutation({
    mutationFn: (next: ProjectSummary[]) =>
      organizeProjects({ data: { items: toOrganizeItems(next) } }),
    onMutate: async (next) => {
      const key = projectsQueryOptions().queryKey;
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ProjectSummary[]>(key);
      queryClient.setQueryData(
        key,
        next.map((project, index) => ({ ...project, sortOrder: index + 1 })),
      );
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          projectsQueryOptions().queryKey,
          context.previous,
        );
      }
      toast.error("Couldn't save the project layout");
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: projectsQueryOptions().queryKey,
      }),
  });

  const patch = (id: string, change: Partial<ProjectSummary>) =>
    save.mutate(
      projects.map((project) =>
        project.id === id ? { ...project, ...change } : project,
      ),
    );

  const moveBefore = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const moving = projects.find((project) => project.id === dragId);
    if (!moving) return;
    const rest = projects.filter((project) => project.id !== dragId);
    const at = rest.findIndex((project) => project.id === targetId);
    rest.splice(at, 0, moving);
    save.mutate(rest);
  };

  return (
    <>
      <datalist id="project-groups">
        {groups.map((group) => (
          <option key={group} value={group} />
        ))}
      </datalist>
      <ul className="grid gap-2 lg:grid-cols-2">
        {projects.map((project) => (
          <li
            key={project.id}
            draggable
            onDragStart={() => setDragId(project.id)}
            onDragEnd={() => setDragId(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              moveBefore(project.id);
              setDragId(null);
            }}
            className={`flex items-center gap-2 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted ${
              dragId === project.id ? "opacity-50" : ""
            }`}
          >
            <GripVertical
              className="size-4 shrink-0 cursor-grab text-muted-foreground"
              aria-hidden
            />
            <button
              type="button"
              aria-label={project.starred ? "Unstar project" : "Star project"}
              title={project.starred ? "Unstar" : "Star"}
              onClick={() => patch(project.id, { starred: !project.starred })}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <Star
                className={`size-4 ${project.starred ? "fill-current" : ""}`}
              />
            </button>
            <Link
              to="/p/$projectId/settings"
              params={{ projectId: project.id }}
              className="flex min-w-0 flex-1 flex-col"
            >
              <span className="flex items-center gap-2">
                <span className="truncate font-medium">{project.name}</span>
                {project.id === currentProjectId ? (
                  <Badge variant="secondary" size="sm">
                    Current
                  </Badge>
                ) : null}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {project.domain ?? "No domain set"}
              </span>
            </Link>
            <input
              list="project-groups"
              defaultValue={project.groupName ?? ""}
              key={`${project.id}:${project.groupName ?? ""}`}
              placeholder="Group"
              aria-label={`Group for ${project.name}`}
              maxLength={60}
              onBlur={(event) => {
                const next = event.target.value.trim() || null;
                if (next !== project.groupName) {
                  patch(project.id, { groupName: next });
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="h-8 w-32 shrink-0 rounded-md border border-border bg-background px-2 text-sm"
            />
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </li>
        ))}
      </ul>
    </>
  );
}

function ArchivedProjects() {
  const queryClient = useQueryClient();
  const archivedQuery = useQuery({
    queryKey: ["projects", "archived"],
    queryFn: () => getArchivedProjects(),
  });
  const archived = archivedQuery.data ?? [];

  const restoreMutation = useMutation({
    mutationFn: (projectId: string) =>
      restoreProject({ data: { archivedProjectId: projectId } }),
    onSuccess: async () => {
      // Prefix match invalidates both the active and archived lists.
      await queryClient.invalidateQueries({
        queryKey: projectsQueryOptions().queryKey,
      });
      toast.success("Project restored");
    },
  });

  const [deleting, setDeleting] = React.useState<{
    id: string;
    name: string;
  } | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (projectId: string) =>
      deleteArchivedProject({ data: { archivedProjectId: projectId } }),
    onSuccess: async () => {
      setDeleting(null);
      await queryClient.invalidateQueries({
        queryKey: ["projects", "archived"],
      });
      toast.success("Project deleted");
    },
  });

  if (archived.length === 0) return null;

  return (
    <section className="space-y-3">
      <SectionHeader title="Archived" />
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {archived.map((project) => (
          <li
            key={project.id}
            className="flex items-center justify-between gap-3 p-3"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-muted-foreground">
                {project.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {project.domain ?? "No domain set"}
              </span>
            </span>
            <span className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => restoreMutation.mutate(project.id)}
                disabled={restoreMutation.isPending}
              >
                Restore
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setDeleting(project)}
              >
                Delete
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {deleting ? (
        <ConfirmDialog
          title={`Permanently delete \u201c${deleting.name}\u201d?`}
          confirmLabel="Delete permanently"
          destructive
          pending={deleteMutation.isPending}
          onClose={() => setDeleting(null)}
          onConfirm={() => deleteMutation.mutate(deleting.id)}
        >
          This deletes the project and all of its data: audits, rank tracking,
          saved keywords, reports, AI visibility, and chats. It can&apos;t be
          undone.
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Checkbox } from "@/client/components/ui/checkbox";
import { projectsQueryOptions } from "@/client/features/projects/projectQueries";

export function ProjectAccessPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (projectIds: string[]) => void;
}) {
  const { data: projects = [], isPending } = useQuery(projectsQueryOptions());

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Loading projects…</p>;
  }

  return (
    <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2">
      {projects.map((project) => {
        const checked = value.includes(project.id);
        return (
          <label
            key={project.id}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
          >
            <Checkbox
              checked={checked}
              onCheckedChange={(next) =>
                onChange(
                  next
                    ? [...value, project.id]
                    : value.filter((id) => id !== project.id),
                )
              }
            />
            <span className="truncate">{project.name}</span>
            {project.domain ? (
              <span className="truncate text-xs text-muted-foreground">
                {project.domain}
              </span>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}

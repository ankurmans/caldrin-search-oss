import { useQuery } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { projectContextQueryKey } from "@/client/features/projects/project-context/shared";
import { getProjectContext } from "@/serverFunctions/projectContext";
import type { SearchPerformanceSearch } from "@/types/schemas/search-performance";

const SCOPES = [
  { id: "all", label: "All queries" },
  { id: "nonBranded", label: "Non-branded" },
  { id: "branded", label: "Branded" },
] as const;

/**
 * Splits queries by the project's brand name with a query filter. A match on
 * the name is a rough split: misspellings and product names are not caught, so
 * the filter is shown as an ordinary query filter that can be edited.
 */
export function BrandScope({
  projectId,
  search,
  onSearchChange,
}: {
  projectId: string;
  search: SearchPerformanceSearch;
  onSearchChange: (update: Partial<SearchPerformanceSearch>) => void;
}) {
  const context = useQuery({
    queryKey: projectContextQueryKey(projectId),
    queryFn: () => getProjectContext({ data: { projectId } }),
    staleTime: 60_000,
  });
  const term = context.data?.brandName?.trim().toLowerCase();
  if (!term) return null;

  const active =
    search.queryText?.toLowerCase() !== term
      ? "all"
      : search.queryMatch === "notContains"
        ? "nonBranded"
        : search.queryMatch === "equals"
          ? "all"
          : "branded";
  const choose = (id: (typeof SCOPES)[number]["id"]) =>
    onSearchChange({
      page: undefined,
      queryText: id === "all" ? undefined : term,
      queryMatch:
        id === "all"
          ? undefined
          : id === "nonBranded"
            ? "notContains"
            : "contains",
    });

  return (
    <div
      role="group"
      aria-label="Brand scope"
      className="flex items-center gap-1"
      title={`Matches queries that contain "${term}"`}
    >
      {SCOPES.map((scope) => (
        <Button
          key={scope.id}
          type="button"
          size="sm"
          variant={active === scope.id ? "secondary" : "ghost"}
          aria-pressed={active === scope.id}
          onClick={() => choose(scope.id)}
        >
          {scope.label}
        </Button>
      ))}
    </div>
  );
}

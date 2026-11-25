import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { SectionHeader } from "@/client/components/PageHeader";
import { QueryError, QueryState } from "@/client/components/QueryState";
import {
  getProjectSitePlatform,
  setProjectSitePlatform,
} from "@/serverFunctions/projects";
import { SITE_HOST_LABELS } from "@/shared/site-host";
import {
  SITE_PLATFORMS,
  SITE_PLATFORM_LABELS,
  type SitePlatform,
} from "@/shared/site-platform";

export function ProjectSitePlatform({
  projectId,
  domain,
}: {
  projectId: string;
  domain: string;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["projectSitePlatform", projectId, domain] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => getProjectSitePlatform({ data: { projectId } }),
  });
  const [selected, setSelected] = useState<SitePlatform | "" | null>(null);
  const update = useMutation({
    mutationFn: (platform: SitePlatform | null) =>
      setProjectSitePlatform({ data: { projectId, domain, platform } }),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
      setSelected(null);
    },
  });
  const refresh = useMutation({
    mutationFn: () =>
      getProjectSitePlatform({ data: { projectId, refresh: true } }),
    onSuccess: (result) => queryClient.setQueryData(queryKey, result),
  });
  const pending = update.isPending || refresh.isPending;

  return (
    <section className="space-y-3 border-t border-border pt-6">
      <SectionHeader title="Site platform" />
      <QueryState
        query={query}
        errorFallback="Could not check the website"
        loading={
          <p className="text-sm text-muted-foreground">Checking the website…</p>
        }
      >
        {(result) => {
          const override = result.platformOverride ?? "";
          const value = selected ?? override;
          return (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Host</dt>
                <dd>
                  {result.siteHost && result.siteHost !== "unknown"
                    ? SITE_HOST_LABELS[result.siteHost]
                    : "Unknown"}
                </dd>
                <dt className="text-muted-foreground">Detected builder</dt>
                <dd>
                  {result.detectedPlatform &&
                  result.detectedPlatform !== "unknown"
                    ? SITE_PLATFORM_LABELS[result.detectedPlatform]
                    : "Unknown"}
                  {result.platformEvidence && (
                    <span className="block text-xs text-muted-foreground">
                      {result.platformEvidence}
                    </span>
                  )}
                </dd>
              </dl>
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  update.mutate(value || null);
                }}
              >
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Website builder
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                    value={value}
                    disabled={pending}
                    onChange={(event) => {
                      const platform = SITE_PLATFORMS.find(
                        (item) => item === event.target.value,
                      );
                      setSelected(platform ?? "");
                    }}
                  >
                    <option value="">Use detected builder</option>
                    {SITE_PLATFORMS.map((platform) => (
                      <option key={platform} value={platform}>
                        {SITE_PLATFORM_LABELS[platform]}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  size="sm"
                  type="submit"
                  disabled={pending || value === override}
                >
                  Save builder
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => refresh.mutate()}
                >
                  {refresh.isPending ? "Checking…" : "Check again"}
                </Button>
              </form>
              {(update.error || refresh.error) && (
                <QueryError
                  error={update.error ?? refresh.error}
                  fallback="Could not update the site platform"
                />
              )}
            </>
          );
        }}
      </QueryState>
    </section>
  );
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader, SectionHeader } from "@/client/components/PageHeader";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonCard } from "@/client/components/SkeletonPresets";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { getContentOverview } from "@/serverFunctions/content";
import { ContentPerformance } from "./ContentPerformance";
import { ReviewInbox } from "./ReviewInbox";
import { StartDraft } from "./StartDraft";
import { DraftEditor } from "./DraftEditor";
import { contentKey } from "./helpers";
import { RefreshQueue } from "./RefreshQueue";
import { OpportunitiesSection } from "./OpportunitiesSection";
import { useStorePlatform } from "./ShopifyPlatformGate";

const SHOPIFY_ERRORS: Record<string, string> = {
  shop_mismatch:
    "The store that answered is not the one you started with. Try again.",
  missing_code: "Shopify did not send an authorization code. Try again.",
  token_exchange_failed:
    "Shopify did not accept the authorization. Try connecting again.",
};

export function ContentPage({
  projectId,
  initialOpportunity,
  initialDraft,
  initialRevision,
}: {
  projectId: string;
  initialOpportunity?: string;
  initialDraft?: string;
  initialRevision?: number;
}) {
  const queryClient = useQueryClient();
  const [openAssetId, setOpenAssetId] = useState<string | null>(
    initialDraft ?? null,
  );
  const [openWriter, setOpenWriter] = useState(false);
  // The OAuth callback returns here with ?shopify_error=<code> on a failure.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("shopify_error");
    if (!code) return;
    toast.error(SHOPIFY_ERRORS[code] ?? "Shopify did not connect the store.");
    params.delete("shopify_error");
    const rest = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${rest ? `?${rest}` : ""}`,
    );
  }, []);
  const query = useQuery({
    queryKey: contentKey(projectId),
    queryFn: () => getContentOverview({ data: { projectId } }),
    refetchOnWindowFocus: "always",
  });
  const platform = useStorePlatform(projectId);
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: contentKey(projectId) }),
    [projectId, queryClient],
  );

  if (query.isLoading) return <SkeletonCard />;
  if (query.isError) {
    return (
      <QueryError error={query.error} fallback="Could not load content." />
    );
  }
  const { connection, opportunities, assets, assignedToMe } = query.data ?? {
    connection: null,
    opportunities: [],
    assets: [],
    assignedToMe: [],
  };
  const opportunity = opportunities.find(
    (item) => item.id === initialOpportunity,
  );
  const countOf = (status: string) =>
    assets.filter((asset) => asset.status === status).length;

  if (openAssetId)
    return (
      <div className="p-4 md:p-6">
        <DraftEditor
          key={openAssetId}
          projectId={projectId}
          assetId={openAssetId}
          revision={openAssetId === initialDraft ? initialRevision : undefined}
          initiallyOpenWriter={openWriter}
          onClose={() => {
            setOpenWriter(false);
            setOpenAssetId(null);
          }}
        />
      </div>
    );

  return (
    <div className="space-y-8 p-4 md:p-6">
      <PageHeader
        title="Content studio"
        description="Drafts, approvals and what is ready to write. Nothing is published without your approval."
      />
      <StartDraft
        projectId={projectId}
        opportunity={opportunity}
        onOpen={(id, ai) => {
          setOpenWriter(ai);
          void refresh();
          setOpenAssetId(id);
        }}
      />
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["Drafts", countOf("draft")],
            ["Approved", countOf("approved")],
            ["Published", countOf("published")],
            ["Failed", countOf("failed")],
          ] as const
        ).map(([label, count]) => (
          <div key={label} className="rounded-lg border bg-card p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{count}</dd>
          </div>
        ))}
      </dl>
      {connection ? (
        <p className="text-xs text-muted-foreground">
          Drafting for {connection.shopDomain}
          {connection.mode === "simulated" ? " (demo store)" : ""}.{" "}
          <Link
            to="/p/$projectId/settings/integrations"
            params={{ projectId }}
            hash="store"
            className="underline underline-offset-2"
          >
            Manage the store connection
          </Link>
        </p>
      ) : platform.data?.visible ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 p-3">
          <p className="text-sm text-muted-foreground">
            Connect your store to publish from Content Studio.
          </p>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={
              <Link
                to="/p/$projectId/settings/integrations"
                params={{ projectId }}
                hash="store"
              />
            }
          >
            Connect a store
          </Button>
        </div>
      ) : null}
      <ReviewInbox drafts={assignedToMe} onOpen={setOpenAssetId} />
      <RefreshQueue
        projectId={projectId}
        opportunities={opportunities}
        onOpen={setOpenAssetId}
        onChange={refresh}
      />
      <OpportunitiesSection
        projectId={projectId}
        opportunities={opportunities}
        canDraft={connection !== null}
        onChange={refresh}
        onDrafted={setOpenAssetId}
      />
      {assets.length > 0 ? (
        <section className="space-y-3">
          <SectionHeader title="Drafts" />
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {assets.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-xl border bg-card p-3 text-left hover:bg-muted/50"
                  onClick={() => setOpenAssetId(a.id)}
                >
                  <span className="truncate text-sm font-medium">
                    {a.title}
                  </span>
                  <Badge variant="outline">{a.status}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {connection ? <ContentPerformance projectId={projectId} /> : null}
    </div>
  );
}

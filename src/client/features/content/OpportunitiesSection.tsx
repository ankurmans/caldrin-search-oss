import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SectionHeader } from "@/client/components/PageHeader";
import { Button } from "@/client/components/ui/button";
import {
  createContentDraft,
  extractContentOpportunities,
  type getContentOverview,
} from "@/serverFunctions/content";
import { unwrap } from "./helpers";

// Only these actions produce an article; technical fixes and link work have
// no draft to write.
const DRAFTABLE = new Set([
  "new_article",
  "create_page",
  "refresh_existing_page",
  "update_collection_page",
  "improve_title_and_meta",
]);

type Opportunity = Awaited<
  ReturnType<typeof getContentOverview>
>["opportunities"][number];

export function OpportunitiesSection({
  projectId,
  opportunities,
  canDraft,
  onChange,
  onDrafted,
}: {
  projectId: string;
  opportunities: Opportunity[];
  /** Drafting needs a connected store. */
  canDraft: boolean;
  onChange: () => void;
  onDrafted: (assetId: string) => void;
}) {
  const extract = useMutation({
    mutationFn: () => extractContentOpportunities({ data: { projectId } }),
    onSuccess: (result) => {
      if (unwrap(result)) onChange();
    },
  });
  // Creating a draft is manager-only; a refusal arrives as a toast.
  const draft = useMutation({
    mutationFn: (input: {
      opportunityId: string;
      generator: "template" | "llm";
    }) => createContentDraft({ data: { projectId, ...input } }),
    onSuccess: (result) => {
      const detail = unwrap(result);
      if (!detail) return;
      onChange();
      onDrafted(detail.asset.id);
    },
  });

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Ready to write"
        hint="Opportunities with a page or article to write. Technical and link work is handled from Opportunities."
        action={
          <Button
            size="sm"
            pending={extract.isPending}
            onClick={() => extract.mutate()}
          >
            Find opportunities
          </Button>
        }
      />
      <Link
        to="/p/$projectId/opportunities"
        params={{ projectId }}
        className="inline-block text-xs underline underline-offset-4"
      >
        See all opportunities with evidence
      </Link>
      {opportunities.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No opportunities yet. Find them from Search Console data.
        </p>
      ) : (
        <ul className="grid items-start gap-3 xl:grid-cols-2">
          {opportunities.map((o) => (
            <li
              key={o.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="break-words text-sm font-medium">{o.query}</p>
                <p className="text-xs text-muted-foreground">
                  {o.dataSource === "gsc" || o.dataSource === "simulated"
                    ? `${o.impressions} impressions · ${o.clicks} clicks · position ${o.position.toFixed(1)} · `
                    : ""}
                  {o.recommendedAction.replaceAll("_", " ")}
                  {o.dataSource === "simulated" ? " · demo data" : ""}
                </p>
                <p className="text-xs text-muted-foreground">{o.reason}</p>
              </div>
              {DRAFTABLE.has(o.recommendedAction) && o.status !== "briefed" ? (
                <Link
                  to="/p/$projectId/content"
                  params={{ projectId }}
                  search={{ opportunity: o.id }}
                  className="text-sm underline"
                  onClick={() => window.scrollTo(0, 0)}
                >
                  Use in brief
                </Link>
              ) : null}
              {!canDraft || !DRAFTABLE.has(o.recommendedAction) ? null : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    pending={draft.isPending}
                    disabled={!canDraft || o.status === "briefed"}
                    onClick={() =>
                      draft.mutate({ opportunityId: o.id, generator: "llm" })
                    }
                  >
                    Write AI draft
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      !canDraft || draft.isPending || o.status === "briefed"
                    }
                    onClick={() =>
                      draft.mutate({
                        opportunityId: o.id,
                        generator: "template",
                      })
                    }
                  >
                    {o.status === "briefed" ? "Drafted" : "Outline only"}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

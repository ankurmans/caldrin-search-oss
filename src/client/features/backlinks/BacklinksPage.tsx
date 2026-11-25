import { useCallback, useMemo } from "react";
import type { SortingState, Updater } from "@tanstack/react-table";
import { BackLink, PageHeader } from "@/client/components/PageHeader";
import { AcquiredPanel } from "@/client/features/link-acquisition/AcquiredPanel";
import { LinkGapPanel } from "@/client/features/link-acquisition/LinkGapPanel";
import { OutreachPanel } from "@/client/features/link-acquisition/OutreachPanel";
import { ProspectsPanel } from "@/client/features/link-acquisition/ProspectsPanel";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import { SavedCompetitorChips } from "@/client/features/site-explorer/SavedCompetitorChips";
import { BacklinksSearchCard } from "./BacklinksSearchCard";
import { BacklinksBody } from "./BacklinksPageContent";
import type { BacklinksPageProps } from "./backlinksPageTypes";
import {
  navigateToBacklinksSearch,
  useBacklinksPageData,
} from "./useBacklinksPageData";
import { useBacklinksDomainExpansion } from "./useBacklinksDomainExpansion";
import { useBacklinksFilters } from "./useBacklinksFilters";
import { useBacklinksSearchHistory } from "@/client/hooks/useBacklinksSearchHistory";
import type { SearchTabInput } from "@/client/features/search-tabs/types";
import { useSearchTabNavigation } from "@/client/features/search-tabs/useSearchTabNavigation";
import {
  BACKLINKS_DEFAULT_SORT,
  DEFAULT_BACKLINKS_PAGE_SIZE,
  backlinksWorkspaceSchema,
  type BacklinksWorkspace,
} from "@/types/schemas/backlinks";

const WORKSPACE_LABELS: Record<BacklinksWorkspace, string> = {
  profile: "Profile",
  gap: "Link Gap",
  prospects: "Prospects",
  outreach: "Outreach",
  acquired: "Acquired Links",
};

export function BacklinksPage({
  projectId,
  searchState,
  navigate,
}: BacklinksPageProps) {
  const filters = useBacklinksFilters();

  // Sort lives in the URL so sort changes and the page reset commit in one
  // navigation (no transient fetch of the old page with the new sort).
  const sorting = useMemo<SortingState>(() => {
    const fallback = BACKLINKS_DEFAULT_SORT[searchState.tab];
    const field = searchState.sort ?? fallback.field;
    const order =
      searchState.order ?? (searchState.sort ? "desc" : fallback.order);
    return [{ id: field, desc: order === "desc" }];
  }, [searchState.order, searchState.sort, searchState.tab]);

  const updateSearch = useCallback(
    (updates: Record<string, unknown>) => {
      navigate({ search: (prev) => ({ ...prev, ...updates }), replace: true });
    },
    [navigate],
  );

  const handleSortingChange = useCallback(
    (updater: Updater<SortingState>) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const first = next[0];
      updateSearch({
        sort: first?.id,
        order: first ? (first.desc ? "desc" : "asc") : undefined,
        page: undefined,
      });
    },
    [sorting, updateSearch],
  );

  const data = useBacklinksPageData({ projectId, searchState, filters });

  const domainExpansion = useBacklinksDomainExpansion({
    projectId,
    searchState,
    rows: data.activeTabErrorMessage ? [] : (data.rowsQuery.data?.rows ?? []),
  });

  const {
    history,
    isLoaded: historyLoaded,
    addSearch,
    removeHistoryItem,
  } = useBacklinksSearchHistory(projectId);
  const urlTabInput = useMemo<SearchTabInput | null>(() => {
    if (searchState.target.trim() === "") return null;
    return {
      type: "backlinks",
      target: searchState.target,
      scope: searchState.scope,
    };
  }, [searchState.scope, searchState.target]);
  const navigateToTab = useCallback(
    (input: SearchTabInput | null) => {
      if (input?.type !== "backlinks") {
        navigate({
          search: () => ({ target: "" }),
          replace: true,
        });
        return;
      }
      navigateToBacklinksSearch(navigate, {
        target: input.target,
        scope: input.scope,
      });
    },
    [navigate],
  );
  const searchTabs = useSearchTabNavigation({
    storageKey: `backlinks:${projectId}`,
    urlInput: urlTabInput,
    getLabel: useCallback(
      (input) => (input.type === "backlinks" ? input.target : ""),
      [],
    ),
    navigateToInput: navigateToTab,
  });
  return (
    <div className="px-4 py-4 pb-24 overflow-auto md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader
          title="Backlinks"
          description="Understand who links to a site, what changed recently, and which pages attract links."
          backLink={
            searchState.target ? (
              <BackLink
                to="/p/$projectId/backlinks"
                params={{ projectId }}
                search={{
                  target: "",
                  scope: undefined,
                  tab: undefined,
                  page: undefined,
                  size: undefined,
                  sort: undefined,
                  order: undefined,
                }}
                replace
              >
                Recent searches
              </BackLink>
            ) : undefined
          }
        />

        <Tabs
          value={searchState.workspace}
          onValueChange={(next) =>
            updateSearch({ ws: next === "profile" ? undefined : next })
          }
        >
          <TabsList
            variant="line"
            className="h-auto! justify-start *:flex-none"
          >
            {backlinksWorkspaceSchema.options.map((workspace) => (
              <TabsTrigger key={workspace} value={workspace}>
                {WORKSPACE_LABELS[workspace]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {searchState.workspace === "gap" ? (
          <LinkGapPanel projectId={projectId} />
        ) : searchState.workspace === "prospects" ? (
          <ProspectsPanel projectId={projectId} />
        ) : searchState.workspace === "outreach" ? (
          <OutreachPanel projectId={projectId} />
        ) : searchState.workspace === "acquired" ? (
          <AcquiredPanel projectId={projectId} />
        ) : (
          <>
            <BacklinksSearchCard
              initialValues={data.searchCardInitialValues}
              onSubmit={(values) => {
                searchTabs.openTab({ type: "backlinks", ...values });
                navigateToBacklinksSearch(navigate, values);
                addSearch({ target: values.target, scope: values.scope });
              }}
            />

            <SavedCompetitorChips
              projectId={projectId}
              currentTarget={
                searchState.scope === "domain" ? searchState.target : ""
              }
              onPick={(domain) => {
                const values = { target: domain, scope: "domain" as const };
                searchTabs.openTab({ type: "backlinks", ...values });
                navigateToBacklinksSearch(navigate, values);
                addSearch(values);
              }}
            />

            <BacklinksBody
              projectId={projectId}
              history={history}
              historyLoaded={historyLoaded}
              data={data}
              searchState={searchState}
              filters={filters}
              sorting={sorting}
              domainExpansion={domainExpansion}
              searchTabs={searchTabs}
              onPageChange={(nextPage) =>
                updateSearch({ page: nextPage === 1 ? undefined : nextPage })
              }
              onPageSizeChange={(nextPageSize) =>
                updateSearch({
                  size:
                    nextPageSize === DEFAULT_BACKLINKS_PAGE_SIZE
                      ? undefined
                      : nextPageSize,
                  page: undefined,
                })
              }
              onRemoveHistoryItem={removeHistoryItem}
              onSortingChange={handleSortingChange}
              onTabChange={(tab) =>
                updateSearch({
                  tab: tab === "backlinks" ? undefined : tab,
                  page: undefined,
                  sort: undefined,
                  order: undefined,
                })
              }
              onViewChange={(view) => updateSearch({ view, page: undefined })}
              onHideSpamChange={(hideSpam) =>
                updateSearch({
                  includeSpam: hideSpam ? undefined : true,
                  page: undefined,
                })
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

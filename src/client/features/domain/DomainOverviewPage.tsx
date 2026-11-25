/* eslint-disable max-lines, max-lines-per-function -- Domain Overview keeps page-only orchestration colocated to avoid fake indirection. */
import { SiteExplorerActions } from "./components/SiteExplorerActions";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { ChevronRight, Globe, Info } from "lucide-react";
import { PageHeader } from "@/client/components/PageHeader";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { Card } from "@/client/components/ui/card";
import { DataTableTabs } from "@/client/components/table/DataTableToolbar";
import { TabsTrigger } from "@/client/components/ui/tabs";
import {
  DEFAULT_DOMAIN_KEYWORDS_PAGE_SIZE,
  type DomainSearchParams,
} from "@/types/schemas/domain";
import {
  LOCATIONS,
  isLabsLocationCode,
} from "@/client/features/keywords/locations";
import { useProjectMarket } from "@/client/features/projects/useProjectMarket";
import { DomainBar } from "@/client/features/domain/components/DomainBar";
import {
  DomainReadyState,
  LastRunBar,
  NoSiteState,
} from "@/client/features/domain/components/DomainStates";
import { useDomainBacklinksQuery } from "@/client/features/domain/hooks/useDomainBacklinksQuery";
import { siteHostname } from "@/client/features/domain/siteExplorerDomain";
import { useDomainSearchHistory } from "@/client/hooks/useDomainSearchHistory";
import type { DomainSearchHistoryItem } from "@/client/hooks/useDomainSearchHistory";
import {
  getDomainSearchChangeValidationErrors,
  getDomainSearchValidationErrors,
} from "@/client/features/domain/domainSearchValidation";
import {
  useDomainOverviewQuery,
  useStoredDomainOverviewQuery,
} from "@/client/features/domain/hooks/useDomainOverviewQuery";
import { useDomainHistoryQuery } from "@/client/features/domain/hooks/useDomainHistoryQuery";
import { CompetitorsCard } from "@/client/features/domain/components/overview/CompetitorsCard";
import { StoredGapCard } from "@/client/features/domain/components/overview/StoredGapCard";
import { useDomainCompetitorsQuery } from "@/client/features/domain/hooks/useDomainCompetitorsQuery";
import { KeywordSampleCard } from "@/client/features/domain/components/overview/KeywordSampleCard";
import { PageFoldersCard } from "@/client/features/domain/components/overview/PageFoldersCard";
import {
  useDomainKeywordSummaryQuery,
  useDomainPagesSummaryQuery,
} from "@/client/features/domain/hooks/useDomainSampleQueries";
import { OverviewMetricsCard } from "@/client/features/domain/components/overview/OverviewMetricsCard";
import { OrganicHistoryCard } from "@/client/features/domain/components/overview/OrganicHistoryCard";
import { MarketsCard } from "@/client/features/domain/components/overview/MarketsCard";
import { FirstPartyStrip } from "@/client/features/domain/components/overview/FirstPartyStrip";
import { AiMentionsView } from "@/client/features/domain/components/ai/AiMentionsView";
import { DomainOverviewLoadingState } from "@/client/features/domain/components/DomainOverviewLoadingState";
import { RecentSearches } from "@/client/components/RecentSearches";
import { QueryError } from "@/client/components/QueryState";
import { DomainSearchCard } from "@/client/features/domain/components/DomainSearchCard";
import { KeywordsTab } from "@/client/features/domain/components/KeywordsTab";
import { PagesTab } from "@/client/features/domain/components/PagesTab";
import type { SearchTabInput } from "@/client/features/search-tabs/types";
import { useSearchTabNavigation } from "@/client/features/search-tabs/useSearchTabNavigation";
import {
  getDefaultSortOrder,
  getResearchInputPath,
  toSortOrderSearchParam,
  toSortSearchParam,
} from "@/client/features/domain/utils";
import {
  RESEARCH_SCOPE_LABELS,
  defaultScopeForInput,
  defaultScopeForPath,
  parseResearchTarget,
  toScopeSearchParam,
  type ResearchScope,
} from "@/shared/researchScope";
import { shouldValidateFieldOnChange } from "@/client/lib/forms";
import { buildDomainFiltersClearSearchUpdate } from "@/client/features/domain/domainFilterUtils";
import { captureClientEvent } from "@/client/lib/posthog";
import type { DomainOverviewRouteState } from "@/client/features/domain/domainRouteState";
import type {
  DomainActiveTab,
  DomainSortMode,
  SortOrder,
} from "@/client/features/domain/types";

type Props = {
  projectId: string;
  routeState: DomainOverviewRouteState;
  navigate: (args: {
    search: (prev: Record<string, unknown>) => Record<string, unknown>;
    replace: boolean;
  }) => void;
};

type DomainNavigate = Props["navigate"];
type DomainSearchUpdate = Partial<DomainSearchParams>;

/** One analysis is one domain, scope and market. */
function analysisKey(
  domain: string,
  scope: ResearchScope,
  locationCode: number | undefined,
) {
  return `${domain}|${scope}|${locationCode ?? ""}`;
}

const KEYWORDS_ONLY_SORTS: ReadonlySet<DomainSortMode> = new Set([
  "rank",
  "score",
  "cpc",
]);

function getSortSearchUpdate(
  nextSort: DomainSortMode,
  nextOrder: SortOrder,
): DomainSearchUpdate {
  return {
    sort: toSortSearchParam(nextSort),
    order: toSortOrderSearchParam(nextSort, nextOrder),
    page: undefined,
  };
}

function getLocationSearchUpdate(
  nextLocationCode: number,
  defaultLocationCode: number,
): DomainSearchUpdate {
  return {
    loc:
      nextLocationCode === defaultLocationCode ? undefined : nextLocationCode,
    page: undefined,
  };
}

function getPageSearchUpdate(nextPage: number): DomainSearchUpdate {
  const safe = Math.max(1, Math.floor(nextPage));
  return { page: safe === 1 ? undefined : safe };
}

function getPageSizeSearchUpdate(nextSize: number): DomainSearchUpdate {
  return {
    size: nextSize === DEFAULT_DOMAIN_KEYWORDS_PAGE_SIZE ? undefined : nextSize,
    page: undefined,
  };
}

function getTabSearchUpdate(
  nextTab: DomainActiveTab,
  currentSort: DomainSortMode,
): DomainSearchUpdate {
  if (nextTab === "keywords") {
    return { tab: undefined, page: undefined };
  }

  const fallbackSortNeeded = KEYWORDS_ONLY_SORTS.has(currentSort);
  const update: DomainSearchUpdate = {
    tab: "pages",
    page: undefined,
  };
  if (fallbackSortNeeded) {
    update.sort = "traffic";
    update.order = getDefaultSortOrder("traffic");
  }
  return update;
}

function getHistorySearchUpdate(
  item: DomainSearchHistoryItem,
  defaultLocationCode: number,
): DomainSearchUpdate {
  const historyLocation =
    item.locationCode != null && isLabsLocationCode(item.locationCode)
      ? item.locationCode
      : defaultLocationCode;

  return {
    ...buildDomainFiltersClearSearchUpdate(),
    domain: item.domain,
    scope: toScopeSearchParam(item.domain, item.scope),
    subdomains: undefined,
    sort: toSortSearchParam(item.sort),
    order: undefined,
    tab: item.tab === "keywords" ? undefined : item.tab,
    loc: historyLocation === defaultLocationCode ? undefined : historyLocation,
    size: undefined,
  };
}

function getSearchSubmitUpdate({
  domain,
  scope,
  sort,
  locationCode,
  currentOrder,
  activeTab,
  defaultLocationCode,
}: {
  domain: string;
  scope: ResearchScope;
  sort: DomainSortMode;
  locationCode: number;
  currentOrder: SortOrder;
  activeTab: DomainActiveTab;
  defaultLocationCode: number;
}): DomainSearchUpdate {
  return {
    ...buildDomainFiltersClearSearchUpdate(),
    domain,
    scope: toScopeSearchParam(domain, scope),
    subdomains: undefined,
    sort: toSortSearchParam(sort),
    order: toSortOrderSearchParam(sort, currentOrder),
    tab: activeTab === "keywords" ? undefined : activeTab,
    loc: locationCode === defaultLocationCode ? undefined : locationCode,
    size: undefined,
  };
}

function useDomainOverviewState({
  navigate,
  routeState,
  projectId,
}: {
  navigate: DomainNavigate;
  routeState: DomainOverviewRouteState;
  projectId: string;
}) {
  const lastTrackedKey = useRef<string>("");
  // Analyses a person has asked for. Everything else only reads what is
  // already stored, so opening, switching or going back never starts a charge.
  const [asked, setAsked] = useState<ReadonlySet<string>>(() => new Set());
  // While editing the domain input, the scope tracks the input's default until
  // the user picks one; a pick survives further edits unless it turns invalid.
  const userPickedScope = useRef(false);

  const {
    history,
    isLoaded: historyLoaded,
    addSearch,
    removeHistoryItem,
  } = useDomainSearchHistory(projectId);

  // Changing what is selected adds a history entry, so back and forward step
  // between domains; refining the view (sort, page, filters) does not.
  const setSearchParams = useCallback(
    (updates: DomainSearchUpdate, options?: { push?: boolean }) => {
      navigate({
        search: (prev) => ({ ...prev, ...updates }),
        replace: !options?.push,
      });
    },
    [navigate],
  );

  const currentKey = analysisKey(
    routeState.domain,
    routeState.scope,
    routeState.sentLocationCode,
  );
  const live = asked.has(currentKey);
  const askFor = useCallback((key: string) => {
    setAsked((previous) =>
      previous.has(key) ? previous : new Set(previous).add(key),
    );
  }, []);
  const analyze = useCallback(() => askFor(currentKey), [askFor, currentKey]);

  const applySort = useCallback(
    (nextSort: DomainSortMode, nextOrder: SortOrder) => {
      setSearchParams(getSortSearchUpdate(nextSort, nextOrder));
    },
    [setSearchParams],
  );

  // Picking a market is a request to read it.
  const applyLocationChange = useCallback(
    (nextLocationCode: number) => {
      const update = getLocationSearchUpdate(
        nextLocationCode,
        routeState.defaultLocationCode,
      );
      askFor(analysisKey(routeState.domain, routeState.scope, update.loc));
      setSearchParams(update, { push: true });
    },
    [
      askFor,
      routeState.defaultLocationCode,
      routeState.domain,
      routeState.scope,
      setSearchParams,
    ],
  );

  const handleSortColumnClick = useCallback(
    (nextSort: DomainSortMode) => {
      const nextOrder =
        nextSort === routeState.sort
          ? routeState.order === "asc"
            ? "desc"
            : "asc"
          : getDefaultSortOrder(nextSort);
      applySort(nextSort, nextOrder);
    },
    [applySort, routeState.order, routeState.sort],
  );

  const goToPage = useCallback(
    (nextPage: number) => {
      setSearchParams(getPageSearchUpdate(nextPage));
    },
    [setSearchParams],
  );

  const setPageSize = useCallback(
    (nextSize: number) => {
      setSearchParams(getPageSizeSearchUpdate(nextSize));
    },
    [setSearchParams],
  );

  const handleTabChange = useCallback(
    (nextTab: DomainActiveTab) => {
      setSearchParams(getTabSearchUpdate(nextTab, routeState.sort));
    },
    [routeState.sort, setSearchParams],
  );

  const handleHistorySelect = useCallback(
    (item: DomainSearchHistoryItem) => {
      setSearchParams(
        getHistorySearchUpdate(item, routeState.defaultLocationCode),
        { push: true },
      );
    },
    [routeState.defaultLocationCode, setSearchParams],
  );

  const sampleInput = {
    projectId,
    domain: routeState.domain,
    scope: routeState.scope,
    locationCode: routeState.sentLocationCode,
  };
  const storedQuery = useStoredDomainOverviewQuery(sampleInput);
  const overviewQuery = useDomainOverviewQuery({
    ...sampleInput,
    enabled: live,
  });
  const overview = overviewQuery.data ?? storedQuery.data ?? null;
  // Each group loads on its own, so a slow or failed history or backlinks
  // read never blanks the headline metrics. The backlinks key matches the
  // Backlinks page, so the two share one cached read.
  const historyQuery = useDomainHistoryQuery({
    projectId,
    domain: routeState.domain,
    locationCode: routeState.sentLocationCode,
    enabled: routeState.view === "overview" && overview !== null,
    live,
  });
  // Each read starts when its view opens, so a visit to the overview does not
  // buy competitors or keyword samples nobody looked at.
  const keywordSummaryQuery = useDomainKeywordSummaryQuery({
    ...sampleInput,
    enabled: routeState.view === "organic" && overview !== null,
  });
  const pagesSummaryQuery = useDomainPagesSummaryQuery({
    ...sampleInput,
    enabled: routeState.view === "organic" && overview !== null,
  });
  const competitorsQuery = useDomainCompetitorsQuery({
    ...sampleInput,
    enabled: routeState.view === "competitors" && overview !== null,
  });
  const backlinksQuery = useDomainBacklinksQuery({
    projectId,
    domain: routeState.domain,
    scope: routeState.scope,
    live,
  });
  const isLoading =
    routeState.domain.trim() !== "" &&
    overview === null &&
    (live ? overviewQuery.isLoading : storedQuery.isLoading);

  // The form adds a domain to research; the one being explored is not in it.
  const controlsForm = useForm({
    defaultValues: {
      domain: "",
      scope: defaultScopeForPath(""),
      sort: routeState.sort,
      locationCode: routeState.locationCode,
    },
    validators: {
      onChange: ({ formApi, value }) =>
        getDomainSearchChangeValidationErrors(
          value,
          shouldValidateFieldOnChange(formApi, "domain"),
          formApi.state.submissionAttempts > 0,
        ),
      onSubmit: ({ value }) => getDomainSearchValidationErrors(value),
    },
    onSubmit: ({ value }) => {
      const parsed = parseResearchTarget(value.domain, value.scope);
      if (!parsed.ok) return;
      const target = parsed.target;
      const update = getSearchSubmitUpdate({
        domain: target.display,
        scope: target.scope,
        sort: value.sort,
        locationCode: value.locationCode,
        currentOrder: routeState.order,
        activeTab: routeState.tab,
        defaultLocationCode: routeState.defaultLocationCode,
      });
      askFor(analysisKey(target.display, target.scope, update.loc));
      setSearchParams(update, { push: true });
    },
  });

  useEffect(() => {
    userPickedScope.current = false;
    controlsForm.reset({
      domain: "",
      scope: defaultScopeForPath(""),
      sort: routeState.sort,
      locationCode: routeState.locationCode,
    });
  }, [
    controlsForm,
    routeState.domain,
    routeState.locationCode,
    routeState.scope,
    routeState.sort,
  ]);

  const handleDomainChange = useCallback(
    (nextDomain: string) => {
      // An explicit pick sticks even when it stops fitting the input (e.g.
      // Subfolder after the path is deleted) — submit validation explains
      // instead of the select silently changing under the user.
      if (userPickedScope.current) return;
      const path = getResearchInputPath(nextDomain);
      const nextScope = defaultScopeForPath(path);
      if (nextScope !== controlsForm.getFieldValue("scope")) {
        controlsForm.setFieldValue("scope", nextScope);
      }
    },
    [controlsForm],
  );

  const handleScopeChange = useCallback(() => {
    userPickedScope.current = true;
  }, []);

  useEffect(() => {
    if (!overviewQuery.isSuccess || !overview) return;
    const key = `${routeState.domain}|${routeState.scope}|${routeState.locationCode}`;
    if (lastTrackedKey.current === key) return;
    lastTrackedKey.current = key;

    captureClientEvent("domain_overview:search_complete", {
      sort_mode: routeState.sort,
      scope: routeState.scope,
      result_count: overview.organicKeywords ?? 0,
      location_code: routeState.locationCode,
    });
    if (!routeState.isOwn) {
      addSearch({
        domain: routeState.domain,
        scope: routeState.scope,
        sort: routeState.sort,
        tab: routeState.tab,
        locationCode: routeState.locationCode,
      });
    }
  }, [
    addSearch,
    overview,
    overviewQuery.isSuccess,
    routeState.domain,
    routeState.isOwn,
    routeState.locationCode,
    routeState.scope,
    routeState.sort,
    routeState.tab,
  ]);

  useEffect(() => {
    if (routeState.domain.trim() !== "") return;
    lastTrackedKey.current = "";
  }, [routeState.domain]);

  // Changing location updates the form before the route navigation commits,
  // so block saves until the rendered results match the selected market.
  const controlsLocationCode = useStore(
    controlsForm.store,
    (s) => s.values.locationCode,
  );
  const canSaveKeywords =
    controlsLocationCode === routeState.locationCode &&
    overview?.hasData === true;

  const handleSearchSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      void controlsForm.handleSubmit();
    },
    [controlsForm],
  );

  return {
    controlsForm,
    isLoading,
    live,
    analyze,
    storedQuery,
    overviewQuery,
    historyQuery,
    keywordSummaryQuery,
    pagesSummaryQuery,
    competitorsQuery,
    backlinksQuery,
    overview,
    canSaveKeywords,
    history,
    historyLoaded,
    removeHistoryItem,
    setSearchParams,
    applySort,
    applyLocationChange,
    handleDomainChange,
    handleScopeChange,
    handleTabChange,
    handleSortColumnClick,
    handleHistorySelect,
    handleSearchSubmit,
    goToPage,
    setPageSize,
  };
}

export type DomainOverviewControlsForm = ReturnType<
  typeof useDomainOverviewState
>["controlsForm"];

const VIEW_NAMES = {
  overview: "Overview",
  organic: "Organic",
  backlinks: "Backlinks",
  competitors: "Competitors",
  ai: "AI Mentions",
} as const;

export function DomainOverviewPage({ projectId, routeState, navigate }: Props) {
  const state = useDomainOverviewState({
    navigate,
    routeState,
    projectId,
  });
  const project = useProjectMarket(projectId);
  const [addOpen, setAddOpen] = useState(false);
  const noSite = routeState.domain === "";
  const addVisible = addOpen || noSite;

  const urlTabInput = useMemo<SearchTabInput | null>(() => {
    // The project's own site is not a research tab; it is always the first chip.
    if (routeState.domain.trim() === "" || routeState.isOwn) return null;
    return {
      type: "domain",
      domain: routeState.domain,
      scope: routeState.scope,
      locationCode: routeState.sentLocationCode,
    };
  }, [
    routeState.domain,
    routeState.isOwn,
    routeState.scope,
    routeState.sentLocationCode,
  ]);

  // Selecting a domain is a new history entry, so back and forward restore
  // it. Null selects the project's own site and keeps the market.
  const navigateToSearchTab = useCallback(
    (input: SearchTabInput | null) => {
      const domain = input?.type === "domain" ? input : null;
      navigate({
        search: (prev) => ({
          ...prev,
          ...buildDomainFiltersClearSearchUpdate(),
          domain: domain?.domain,
          scope: domain
            ? toScopeSearchParam(domain.domain, domain.scope)
            : undefined,
          subdomains: undefined,
          sort: undefined,
          order: undefined,
          tab: undefined,
          page: undefined,
          loc: domain ? domain.locationCode : prev.loc,
          size: undefined,
        }),
        replace: false,
      });
    },
    [navigate],
  );

  const searchTabs = useSearchTabNavigation({
    storageKey: `domain:${projectId}`,
    urlInput: urlTabInput,
    getLabel: useCallback(
      (input) => {
        if (input.type !== "domain") return "";
        const locationSuffix =
          input.locationCode == null ||
          input.locationCode === routeState.defaultLocationCode
            ? ""
            : ` ${LOCATIONS[input.locationCode] ?? input.locationCode}`;
        return `${input.domain}${locationSuffix}`;
      },
      [routeState.defaultLocationCode],
    ),
    navigateToInput: navigateToSearchTab,
  });
  const researchTabs = searchTabs.tabs.filter(
    (tab) =>
      tab.input.type === "domain" &&
      siteHostname(tab.input.domain) !== routeState.ownDomain,
  );

  const openDomain = (domain: string) =>
    navigateToSearchTab({
      type: "domain",
      domain,
      scope: defaultScopeForInput(domain),
      locationCode: routeState.sentLocationCode,
    });

  const tabs = (
    <DataTableTabs
      value={routeState.tab}
      onValueChange={(value) =>
        state.handleTabChange(value === "pages" ? "pages" : "keywords")
      }
    >
      <TabsTrigger value="keywords">Top Keywords</TabsTrigger>
      <TabsTrigger value="pages">Top Pages</TabsTrigger>
    </DataTableTabs>
  );

  // The error stays until the query for this search succeeds; editing the
  // form doesn't clear it.
  const overviewError = state.overviewQuery.isError ? (
    <QueryError
      error={state.overviewQuery.error}
      fallback="Lookup failed."
      onRetry={() => void state.overviewQuery.refetch()}
      isRetrying={state.overviewQuery.isFetching}
    />
  ) : state.storedQuery.isError ? (
    <QueryError
      error={state.storedQuery.error}
      fallback="Lookup failed."
      onRetry={() => void state.storedQuery.refetch()}
      isRetrying={state.storedQuery.isFetching}
    />
  ) : null;

  const overview = state.overview;
  const ownLabel = routeState.isOwn ? "Your site" : "Research domain";

  const marketsCard = overview ? (
    <MarketsCard
      projectId={projectId}
      domain={overview.domain}
      searchedLocationCode={routeState.locationCode}
      projectLocationCode={routeState.defaultLocationCode}
      current={{
        organicKeywords: overview.organicKeywords,
        organicTraffic: overview.organicTraffic,
      }}
    />
  ) : null;

  const readyState = (
    <DomainReadyState
      projectId={projectId}
      domain={routeState.domain}
      isOwn={routeState.isOwn}
      locationCode={routeState.locationCode}
      pending={state.overviewQuery.isFetching}
      onAnalyse={state.analyze}
    />
  );

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader
          title="Site Explorer"
          description="Estimated organic traffic, keywords, backlinks and AI answers for your site and any domain you research."
        />

        {project === undefined && routeState.domain === "" ? null : (
          <DomainBar
            projectId={projectId}
            ownDomain={routeState.ownDomain}
            ownSelected={routeState.isOwn}
            researchTabs={researchTabs}
            activeTabId={searchTabs.activeTabId}
            locationCode={routeState.locationCode}
            addOpen={addVisible}
            onSelectOwn={() => navigateToSearchTab(null)}
            onSelectTab={searchTabs.selectTab}
            onCloseTab={searchTabs.closeTab}
            onViewedTab={searchTabs.markTabViewed}
            onSelectSaved={openDomain}
            onToggleAdd={() => setAddOpen((open) => !open)}
            onLocationChange={state.applyLocationChange}
          />
        )}

        {addVisible ? (
          <DomainSearchCard
            controlsForm={state.controlsForm}
            isLoading={state.isLoading}
            onSubmit={(event) => {
              state.handleSearchSubmit(event);
              setAddOpen(false);
            }}
            onDomainChange={state.handleDomainChange}
            onScopeChange={state.handleScopeChange}
          />
        ) : null}

        {noSite ? (
          project === undefined ? (
            <DomainOverviewLoadingState />
          ) : (
            <>
              <NoSiteState
                projectId={projectId}
                invalid={Boolean(project.domain)}
              />
              <RecentSearches
                items={state.history}
                loaded={state.historyLoaded}
                onRemove={state.removeHistoryItem}
                emptyIcon={Globe}
                emptyTitle="Research a domain to get started"
                getTitle={(item) => item.domain}
                getSubtitle={(item) => RESEARCH_SCOPE_LABELS[item.scope]}
                renderLink={(item, props) => (
                  <button
                    type="button"
                    onClick={() => state.handleHistorySelect(item)}
                    {...props}
                  />
                )}
              />
            </>
          )
        ) : state.isLoading ? (
          <DomainOverviewLoadingState />
        ) : overview === null && overviewError ? (
          overviewError
        ) : overview === null ? (
          <>
            {routeState.isOwn && routeState.view === "overview" ? (
              <FirstPartyStrip
                projectId={projectId}
                domain={routeState.ownDomain}
              >
                {readyState}
              </FirstPartyStrip>
            ) : (
              readyState
            )}
          </>
        ) : (
          <>
            {overviewError}
            {!overview.hasData ? (
              <Alert variant="info">
                <Info />
                <AlertDescription className="text-foreground">
                  Not enough data for this scope yet. Try another domain or a
                  broader scope.
                </AlertDescription>
              </Alert>
            ) : null}

            <nav
              aria-label="Breadcrumb"
              className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
            >
              <span>Site Explorer</span>
              <ChevronRight className="size-3" />
              <span>{ownLabel}</span>
              <ChevronRight className="size-3" />
              <span className="text-foreground">
                {VIEW_NAMES[routeState.view]}
              </span>
            </nav>

            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold break-all">
                {overview.displayTarget}
              </h2>
              <Badge variant={routeState.isOwn ? "secondary" : "outline"}>
                {ownLabel}
              </Badge>
              {overview.scope !== "domain" ? (
                <Badge variant="outline">
                  {RESEARCH_SCOPE_LABELS[overview.scope]}
                </Badge>
              ) : null}
              <div className="ml-auto">
                <SiteExplorerActions
                  projectId={projectId}
                  domain={overview.domain}
                  isOwn={routeState.isOwn}
                />
              </div>
            </div>

            <LastRunBar
              fetchedAt={overview.fetchedAt}
              pending={state.overviewQuery.isFetching}
              onRun={() =>
                state.live
                  ? void state.overviewQuery.refetch()
                  : state.analyze()
              }
            />

            {routeState.view === "overview" || routeState.view === "organic" ? (
              <OverviewMetricsCard
                overview={overview}
                variant={routeState.view}
                domainRank={state.backlinksQuery.data?.summary.rank}
                domainRankDate={state.backlinksQuery.data?.fetchedAt}
              />
            ) : null}

            {routeState.view === "overview" ? (
              <>
                <OrganicHistoryCard
                  query={state.historyQuery}
                  currentPositions={overview.positions}
                  onLoad={state.live ? undefined : state.analyze}
                />
                {/* Markets is short, so for your own domain it joins the card
                    flow below and fills the gap beside a longer card. */}
                {routeState.isOwn ? (
                  <FirstPartyStrip
                    projectId={projectId}
                    domain={overview.domain}
                  >
                    {marketsCard}
                  </FirstPartyStrip>
                ) : (
                  marketsCard
                )}
              </>
            ) : null}

            {routeState.view === "organic" ? (
              <>
                <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
                  <KeywordSampleCard query={state.keywordSummaryQuery} />
                  <PageFoldersCard query={state.pagesSummaryQuery} />
                </div>

                <Card className="gap-0 py-0">
                  <div className="px-4 pb-4">
                    {routeState.tab === "pages" ? (
                      <PagesTab
                        projectId={projectId}
                        target={overview.displayTarget}
                        hostname={overview.domain}
                        scope={overview.scope}
                        routeState={routeState}
                        tabs={tabs}
                        setSearchParams={state.setSearchParams}
                        onSortClick={state.handleSortColumnClick}
                        onPageChange={state.goToPage}
                        onPageSizeChange={state.setPageSize}
                      />
                    ) : (
                      <KeywordsTab
                        projectId={projectId}
                        target={overview.displayTarget}
                        hostname={overview.domain}
                        scope={overview.scope}
                        routeState={routeState}
                        tabs={tabs}
                        canSaveKeywords={state.canSaveKeywords}
                        setSearchParams={state.setSearchParams}
                        onSortClick={state.handleSortColumnClick}
                        onPageChange={state.goToPage}
                        onPageSizeChange={state.setPageSize}
                      />
                    )}
                  </div>
                </Card>
              </>
            ) : null}

            {routeState.view === "competitors" ? (
              <>
                <CompetitorsCard
                  projectId={projectId}
                  scope={overview.scope}
                  locationCode={routeState.sentLocationCode}
                  query={state.competitorsQuery}
                />
                {state.competitorsQuery.data?.isProjectDomain ? (
                  <StoredGapCard projectId={projectId} />
                ) : null}
              </>
            ) : null}

            {routeState.view === "ai" ? (
              <AiMentionsView
                projectId={projectId}
                domain={overview.domain}
                scope={overview.scope}
                locationCode={routeState.sentLocationCode}
                projectDomain={project?.domain ?? undefined}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

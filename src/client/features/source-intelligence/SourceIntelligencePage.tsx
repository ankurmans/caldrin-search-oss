import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";
import type { z } from "zod";
import { useMemo, useState } from "react";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import { DataTable, useDataTable } from "@/client/components/table/DataTable";
import { TablePagination } from "@/client/components/table/TablePagination";
import { getSourceIntelligence } from "@/serverFunctions/source-intelligence";
import {
  SOURCE_PAGE_SIZES,
  SOURCE_SORT_FIELDS,
  SOURCE_VIEWS,
  type SourceFilters,
  type SourceSortField,
  type SourceView,
  type sourceSearchSchema,
} from "@/types/schemas/source-intelligence";
import {
  enrichedQueryColumns,
  queryColumns,
  sourceColumns,
} from "./sourceColumns";
import { CitationProspects } from "./CitationProspects";
import { FanOutExport } from "./FanOutExport";
import { FanOutPeriodComparison } from "./FanOutPeriodComparison";
import { FanOutPrompts } from "./FanOutPrompts";
import { SourceFilterBar, sourceHasFilters } from "./SourceFilterBar";
import { SourceCoverage } from "./SourceCoverage";
import { SourceDetailSheet } from "./SourceDetailSheet";
import {
  DEFAULT_FILTERS,
  sourceKeys,
  type QueryTableRow,
  type SourceTableRow,
} from "./sourceIntelligence";

const VIEW_LABELS: Record<SourceView, string> = {
  sources: "Pages",
  domains: "Domains",
  queries: "Query fan-out",
};
const OWNERSHIP = [
  { id: "own", label: "Your site", color: "bg-primary" },
  { id: "competitor", label: "Competitors", color: "bg-blue-500" },
  { id: "third_party", label: "Third-party", color: "bg-teal-500" },
  { id: "unknown", label: "Unknown type", color: "bg-muted-foreground" },
] as const;

function isSortField(id: string): id is SourceSortField {
  return SOURCE_SORT_FIELDS.some((field) => field === id);
}

type Search = z.infer<typeof sourceSearchSchema>;

export function SourceIntelligencePage({
  projectId,
  search,
  onSearch,
}: {
  projectId: string;
  search: Search;
  onSearch: (search: Search) => void;
}) {
  const { view = "sources", by = "prompt", answer, ...filterSearch } = search;
  const filters: SourceFilters = {
    ...DEFAULT_FILTERS,
    ...filterSearch,
    appearance:
      view === "queries" ? undefined : (filterSearch.appearance ?? "cited"),
  };
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(50);
  const [sorting, setSorting] = useState<SortingState>([
    {
      id: view === "queries" ? "answers" : (filters.appearance ?? "cited"),
      desc: true,
    },
  ]);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const sort = sorting[0];
  const sortBy: SourceSortField =
    sort && isSortField(sort.id) ? sort.id : "cited";
  const sortDir = sort && !sort.desc ? "asc" : "desc";

  const dataQuery = useQuery({
    queryKey: [
      ...sourceKeys.all(projectId),
      view,
      filters,
      page,
      pageSize,
      sortBy,
      sortDir,
    ],
    queryFn: () =>
      getSourceIntelligence({
        data: { projectId, filters, view, sortBy, sortDir, page, pageSize },
      }),
    placeholderData: keepPreviousData,
  });
  const data = dataQuery.data;
  const marketSelected = Boolean(filters.locationCode && filters.languageCode);

  function change(patch: Partial<SourceFilters>) {
    onSearch({ ...search, ...patch, answer: undefined });
    setPage(1);
  }
  function switchView(next: SourceView) {
    onSearch({ ...search, view: next, answer: undefined });
    setPage(1);
    setSorting([{ id: next === "queries" ? "answers" : "cited", desc: true }]);
  }

  const sourceTable = useDataTable<SourceTableRow>({
    data: view === "queries" ? [] : (data?.rows ?? []),
    columns: sourceColumns,
    getRowId: (row) => row.key,
    state: { sorting },
    onSortingChange: (updater) => {
      setSorting(updater);
      setPage(1);
    },
    manualSorting: true,
    manualPagination: true,
    enableSortingRemoval: false,
  });
  const queryTable = useDataTable<QueryTableRow>({
    data: view === "queries" ? (data?.queryRows ?? []) : [],
    columns: marketSelected ? enrichedQueryColumns : queryColumns,
    getRowId: (row) => row.query,
    state: { sorting },
    onSortingChange: (updater) => {
      setSorting(updater);
      setPage(1);
    },
    manualSorting: true,
    manualPagination: true,
    enableSortingRemoval: false,
  });

  const openRow = useMemo(
    () => data?.rows.find((row) => row.key === openKey) ?? null,
    [data, openKey],
  );
  const filtered = sourceHasFilters(filters);

  const toolbar = (
    <SourceFilterBar
      key={filters.sourceDomain ?? ""}
      filters={filters}
      data={data}
      onChange={change}
    />
  );
  const footer = (
    <TablePagination
      page={page}
      pageSize={pageSize}
      pageSizes={SOURCE_PAGE_SIZES}
      totalCount={data?.total ?? null}
      isLoading={dataQuery.isFetching}
      onPageChange={setPage}
      onPageSizeChange={(size) => {
        const next = SOURCE_PAGE_SIZES.find((s) => s === size);
        if (next) setPageSize(next);
        setPage(1);
      }}
    />
  );

  const empty = {
    kind: "no-data" as const,
    title: "Nothing captured for these filters",
    description:
      "Searches and retrieved pages appear for answers collected after this update, where the provider returns them.",
  };

  return (
    <div className="px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Source intelligence</h1>
          <p className="text-sm text-muted-foreground">
            Saved searches, retrieved pages and citations from tracked AI
            answers.
          </p>
        </header>

        {data ? <SourceCoverage data={data} /> : null}

        <div className="flex flex-wrap gap-2" role="tablist" aria-label="View">
          {SOURCE_VIEWS.map((v) => (
            <Button
              key={v}
              role="tab"
              aria-selected={view === v}
              size="sm"
              variant={view === v ? "default" : "outline"}
              onClick={() => switchView(v)}
            >
              {VIEW_LABELS[v]}
            </Button>
          ))}
        </div>

        {view !== "queries" && data ? (
          <section className="space-y-2">
            <div
              className="flex gap-1"
              role="group"
              aria-label="Source evidence"
            >
              {(["cited", "retrieved"] as const).map((kind) => (
                <Button
                  key={kind}
                  size="sm"
                  variant={filters.appearance === kind ? "secondary" : "ghost"}
                  aria-pressed={filters.appearance === kind}
                  onClick={() => {
                    change({ appearance: kind, ownership: undefined });
                    setSorting([{ id: kind, desc: true }]);
                  }}
                >
                  {kind === "cited" ? "Cited" : "Retrieved"}
                </Button>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {OWNERSHIP.map(({ id, label, color }) => {
                const count = data.breakdown[id];
                const total = Object.values(data.breakdown).reduce(
                  (sum, value) => sum + value,
                  0,
                );
                return (
                  <button
                    key={id}
                    type="button"
                    className="rounded-lg border bg-card p-2.5 text-left focus-visible:outline-ring aria-pressed:border-primary"
                    aria-pressed={filters.ownership === id}
                    onClick={() =>
                      change({
                        ownership: filters.ownership === id ? undefined : id,
                      })
                    }
                  >
                    <span className="flex justify-between gap-2 text-xs">
                      <span>{label}</span>
                      <span className="tabular-nums">{count}</span>
                    </span>
                    <span className="mt-2 block h-1 rounded-full bg-muted">
                      <span
                        className={`block h-full rounded-full ${color}`}
                        style={{
                          width: `${total ? (count / total) * 100 : 0}%`,
                        }}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {view === "sources" && (
          <CitationProspects
            key={JSON.stringify(filters)}
            projectId={projectId}
            filters={filters}
          />
        )}

        {view === "queries" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={by === "prompt" ? "secondary" : "ghost"}
              aria-pressed={by === "prompt"}
              onClick={() => onSearch({ ...search, by: "prompt" })}
            >
              By prompt
            </Button>
            <Button
              size="sm"
              variant={by === "query" ? "secondary" : "ghost"}
              aria-pressed={by === "query"}
              onClick={() =>
                onSearch({ ...search, by: "query", answer: undefined })
              }
            >
              By query
            </Button>
            <span className="text-sm text-muted-foreground">
              Searches reported while an engine prepared a saved answer.
            </span>
          </div>
        ) : null}

        {view === "queries" && by === "prompt" ? (
          <FanOutPrompts
            key={JSON.stringify(filters)}
            projectId={projectId}
            filters={filters}
            linkedAnswer={answer}
            toolbar={toolbar}
          />
        ) : dataQuery.isError && !data ? (
          <QueryError
            error={dataQuery.error}
            fallback="Failed to load source intelligence"
            onRetry={() => void dataQuery.refetch()}
            isRetrying={dataQuery.isFetching}
          />
        ) : view === "queries" ? (
          <>
            <FanOutPeriodComparison projectId={projectId} filters={filters} />
            <DataTable
              table={queryTable}
              isLoading={dataQuery.isLoading}
              isRefreshing={dataQuery.isFetching && !dataQuery.isLoading}
              isFiltered={Boolean(filtered)}
              empty={empty}
              scrollClassName="max-h-[70vh]"
              toolbar={
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {toolbar}
                  <FanOutExport
                    projectId={projectId}
                    filters={filters}
                    sortBy={sortBy}
                    sortDir={sortDir}
                    marketSelected={marketSelected}
                    rows={queryTable.options.data}
                    disabled={!data?.total || dataQuery.isFetching}
                  />
                </div>
              }
              footer={footer}
            />
          </>
        ) : (
          <DataTable
            table={sourceTable}
            isLoading={dataQuery.isLoading}
            isRefreshing={dataQuery.isFetching && !dataQuery.isLoading}
            isFiltered={Boolean(filtered)}
            empty={empty}
            scrollClassName="max-h-[70vh]"
            onRowClick={(row, event) => {
              if (
                event.target instanceof HTMLElement &&
                event.target.closest("a,button")
              )
                return;
              setOpenKey(row.original.key);
            }}
            activeRowId={openKey ?? undefined}
            toolbar={toolbar}
            footer={footer}
          />
        )}
      </div>

      <SourceDetailSheet
        projectId={projectId}
        filters={filters}
        row={view === "queries" ? null : openRow}
        onClose={() => setOpenKey(null)}
      />
    </div>
  );
}

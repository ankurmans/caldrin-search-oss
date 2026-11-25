import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type {
  RowSelectionState,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import {
  DataTable,
  useDataTable,
  useSelectionAnchor,
} from "@/client/components/table/DataTable";
import { TablePagination } from "@/client/components/table/TablePagination";
import { getKeywordGap } from "@/serverFunctions/site-explorer";
import {
  GAP_PAGE_SIZES,
  GAP_SORT_FIELDS,
  type GapSortField,
} from "@/types/schemas/keyword-gap";
import { exportGap } from "./exportGap";
import {
  activeFilterCount,
  buildQuery,
  gapKeys,
  NO_FILTERS,
  parseViewConfig,
  readHiddenColumns,
  writeHiddenColumns,
  type GapFilterState,
  type GapRow,
} from "./gap";
import { buildGapColumns } from "./gapColumns";
import { GapBulkBar } from "./GapBulkBar";
import { GapCoverage } from "./GapCoverage";
import { GapRowSheet } from "./GapRowSheet";
import { GapRunPanel } from "./GapRunPanel";
import { GapToolbar } from "./GapToolbar";

function isSortField(id: string): id is GapSortField {
  return GAP_SORT_FIELDS.some((field) => field === id);
}

export function KeywordGapPage({ projectId }: { projectId: string }) {
  const [filters, setFilters] = useState<GapFilterState>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "searchVolume", desc: true },
  ]);
  const [hidden, setHidden] = useState<VisibilityState>(readHiddenColumns);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | undefined>(undefined);
  const [showRun, setShowRun] = useState(false);
  const anchor = useSelectionAnchor();

  const sort = sorting[0];
  const sortBy: GapSortField =
    sort && isSortField(sort.id) ? sort.id : "searchVolume";
  const sortDir = sort && !sort.desc ? "asc" : "desc";
  const query = useMemo(
    () => buildQuery({ filters, runId, page, pageSize, sortBy, sortDir }),
    [filters, runId, page, pageSize, sortBy, sortDir],
  );

  const gapQuery = useQuery({
    queryKey: [...gapKeys.table(projectId), query],
    queryFn: () => getKeywordGap({ data: { projectId, query } }),
    placeholderData: keepPreviousData,
  });
  const data = gapQuery.data;
  const activeRunId = data?.run.id ?? runId ?? "";

  function changeFilters(patch: Partial<GapFilterState>) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
    setSelection({});
  }

  function applyView(raw: string) {
    const config = parseViewConfig(raw);
    if (!config) return void toast.error("That saved view is no longer valid");
    setFilters(config.filters);
    setSorting([{ id: config.sortBy, desc: config.sortDir === "desc" }]);
    setPageSize(config.pageSize);
    setPage(1);
    setSelection({});
  }

  const columns = useMemo(() => buildGapColumns(anchor), [anchor]);

  const table = useDataTable<GapRow>({
    data: data?.rows ?? [],
    columns,
    getRowId: (row) => row.id,
    state: { sorting, rowSelection: selection, columnVisibility: hidden },
    onSortingChange: (updater) => {
      setSorting(updater);
      setPage(1);
    },
    onRowSelectionChange: setSelection,
    onColumnVisibilityChange: (updater) => {
      setHidden((current) => {
        const next = typeof updater === "function" ? updater(current) : updater;
        writeHiddenColumns(next);
        return next;
      });
    },
    manualSorting: true,
    manualPagination: true,
    enableSortingRemoval: false,
  });

  const selectedRows = table
    .getSelectedRowModel()
    .rows.map((row) => row.original);
  const openRow = data?.rows.find((row) => row.id === openRowId) ?? null;
  const filterCount = activeFilterCount(filters);

  const viewConfig = JSON.stringify({ filters, sortBy, sortDir, pageSize });

  if (gapQuery.isError && !data) {
    return (
      <div className="px-4 py-4 md:px-6 md:py-6">
        <QueryError
          error={gapQuery.error}
          fallback="Failed to load the keyword gap"
          onRetry={() => void gapQuery.refetch()}
          isRetrying={gapQuery.isFetching}
        />
      </div>
    );
  }

  const noRunYet = !gapQuery.isLoading && data === null;

  return (
    <div className="px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Keyword gap</h1>
            <p className="text-sm text-muted-foreground">
              Keywords your saved competitors rank for that you do not, or where
              they rank ahead of you. Third-party DataForSEO estimates, kept
              apart from your Search Console data.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link to="/p/$projectId/competitors" params={{ projectId }} />
              }
            >
              Competitors
            </Button>
            {!noRunYet ? (
              <Button
                variant="outline"
                onClick={() => setShowRun((open) => !open)}
              >
                <Plus data-icon="inline-start" /> New analysis
              </Button>
            ) : null}
          </div>
        </header>

        {noRunYet || showRun ? (
          <GapRunPanel
            projectId={projectId}
            onDone={(id) => {
              setRunId(id);
              setShowRun(false);
              setPage(1);
            }}
          />
        ) : null}

        {data ? <GapCoverage data={data} /> : null}

        {noRunYet ? null : (
          <DataTable
            table={table}
            isLoading={gapQuery.isLoading}
            isRefreshing={gapQuery.isFetching && !gapQuery.isLoading}
            isFiltered={filterCount > 0}
            onClearFilters={() => changeFilters(NO_FILTERS)}
            error={
              gapQuery.isError ? (
                <QueryError
                  error={gapQuery.error}
                  fallback="Failed to refresh the keyword gap"
                  onRetry={() => void gapQuery.refetch()}
                  isRetrying={gapQuery.isFetching}
                />
              ) : undefined
            }
            empty={{
              kind: "no-data",
              title: "No keywords in this run",
              description:
                "The provider returned nothing for these competitors in this market.",
            }}
            scrollClassName="max-h-[70vh]"
            onRowClick={(row, event) => {
              if (
                event.target instanceof HTMLElement &&
                event.target.closest("a,button,[role=checkbox]")
              )
                return;
              setOpenRowId(row.original.id);
            }}
            activeRowId={openRowId ?? undefined}
            toolbar={
              <GapToolbar
                projectId={projectId}
                table={table}
                data={data}
                filters={filters}
                filterCount={filterCount}
                filtersOpen={filtersOpen}
                setFiltersOpen={setFiltersOpen}
                changeFilters={changeFilters}
                applyView={applyView}
                exportAll={(format) => exportGap(projectId, query, format)}
                viewConfig={viewConfig}
              />
            }
            footer={
              <TablePagination
                page={page}
                pageSize={pageSize}
                pageSizes={GAP_PAGE_SIZES}
                totalCount={data?.total ?? null}
                isLoading={gapQuery.isFetching}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
              />
            }
          />
        )}

        {noRunYet ? null : data && data.total === 0 && filterCount === 0 ? (
          <EmptyState
            kind="no-data"
            title="No gaps found"
            description="Every keyword the provider returned for these competitors is already covered."
          />
        ) : null}
      </div>

      <GapBulkBar
        projectId={projectId}
        runId={activeRunId}
        locationCode={data?.run.locationCode}
        rows={selectedRows}
        onClear={() => setSelection({})}
      />

      <GapRowSheet
        projectId={projectId}
        runId={activeRunId}
        row={openRow}
        onClose={() => setOpenRowId(null)}
      />
    </div>
  );
}

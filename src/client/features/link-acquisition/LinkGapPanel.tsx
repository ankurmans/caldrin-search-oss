/* eslint-disable max-lines, max-lines-per-function */
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { RowSelectionState, SortingState } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/client/components/EmptyState";
import { ExportMenu } from "@/client/components/ExportMenu";
import { QueryError } from "@/client/components/QueryState";
import {
  DataTable,
  makeSelectionColumn,
  useDataTable,
  useSelectionAnchor,
} from "@/client/components/table/DataTable";
import {
  TableBulkActionBar,
  TableBulkActionButton,
} from "@/client/components/table/TableBulkActionBar";
import {
  DataTableFilterPanel,
  DataTableFilterToggle,
  DataTableRangeFilter,
  DataTableToolbar,
} from "@/client/components/table/DataTableToolbar";
import { TablePagination } from "@/client/components/table/TablePagination";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { formatCompactDate } from "@/client/features/backlinks/backlinksPageUtils";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getLinkGap,
  saveLinkProspectsFromGap,
} from "@/serverFunctions/link-acquisition";
import {
  LINK_RECOMMENDATIONS,
  type LinkRecommendation,
} from "@/shared/link-acquisition";
import {
  LINK_GAP_SORT_FIELDS,
  type LinkGapQuery,
} from "@/types/schemas/link-acquisition";
import { LinkCandidateSheet } from "./LinkCandidateSheet";
import { LinkGapRunPanel } from "./LinkGapRunPanel";
import { QualificationSettings } from "./QualificationSettings";
import { buildLinkGapColumns } from "./linkGapColumns";
import { prospectKeys } from "./prospects";
import {
  exportGap,
  linkGapKeys,
  recommendationLabel,
  type LinkGapRow,
} from "./linkGap";

const PAGE_SIZES = [25, 50, 100, 200] as const;
const ANY = "any";

type Filters = {
  search: string;
  minCompetitors: number | null;
  recommendation: LinkRecommendation | null;
  competitor: string | null;
  maxSpam: string;
  minRank: string;
  evidence: "any" | "read" | "unread";
};
const NO_FILTERS: Filters = {
  search: "",
  minCompetitors: null,
  recommendation: null,
  competitor: null,
  maxSpam: "",
  minRank: "",
  evidence: "any",
};

function isSortField(id: string): id is LinkGapQuery["sortBy"] {
  return LINK_GAP_SORT_FIELDS.some((field) => field === id);
}

function num(value: string) {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
}

function Pick({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onChange: (next: string) => void;
}) {
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => next && onChange(next)}
    >
      <SelectTrigger size="sm" className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function LinkGapPanel({ projectId }: { projectId: string }) {
  const { showCosts } = useCostDisplay();
  const queryClient = useQueryClient();
  const anchor = useSelectionAnchor();
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "score", desc: true },
  ]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showRun, setShowRun] = useState(false);

  const sort = sorting[0];
  const query = useMemo<LinkGapQuery>(
    () => ({
      search: filters.search.trim() || undefined,
      minCompetitors: filters.minCompetitors ?? undefined,
      recommendation: filters.recommendation ?? undefined,
      competitor: filters.competitor ?? undefined,
      maxSpamScore: num(filters.maxSpam),
      minDomainRank: num(filters.minRank),
      hasEvidence:
        filters.evidence === "any" ? undefined : filters.evidence === "read",
      page,
      pageSize,
      sortBy: sort && isSortField(sort.id) ? sort.id : "score",
      sortDir: sort && !sort.desc ? "asc" : "desc",
    }),
    [filters, page, pageSize, sort],
  );

  const gapQuery = useQuery({
    queryKey: [...linkGapKeys.table(projectId), query],
    queryFn: () => getLinkGap({ data: { projectId, query } }),
    placeholderData: keepPreviousData,
  });
  const data = gapQuery.data;
  const columns = useMemo(
    () => [
      makeSelectionColumn<LinkGapRow>(
        anchor,
        (row) => `Select ${row.original.referringDomain}`,
      ),
      ...buildLinkGapColumns(),
    ],
    [anchor],
  );
  const selectedDomains = (data?.rows ?? [])
    .filter((row) => selection[row.id])
    .map((row) => row.referringDomain);
  const save = useMutation({
    mutationFn: () =>
      saveLinkProspectsFromGap({
        data: {
          projectId,
          input: {
            runId: data?.run.id ?? "",
            domains: selectedDomains,
            campaignMode: "earned_editorial",
          },
        },
      }),
    onSuccess: (result) => {
      if (!result.ok) return void toast.error(result.reason);
      const { created, alreadySaved, filedAsSponsored } = result.data;
      toast.success(
        `${created} saved as prospects${alreadySaved ? `, ${alreadySaved} already saved` : ""}${filedAsSponsored ? `, ${filedAsSponsored} filed as sponsored` : ""}`,
      );
      setSelection({});
      void queryClient.invalidateQueries({
        queryKey: prospectKeys.all(projectId),
      });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error, "Failed")),
  });
  const table = useDataTable<LinkGapRow>({
    data: data?.rows ?? [],
    columns,
    getRowId: (row) => row.id,
    state: { sorting, rowSelection: selection },
    onRowSelectionChange: setSelection,
    enableRowSelection: true,
    onSortingChange: (updater) => {
      setSorting(updater);
      setPage(1);
    },
    manualSorting: true,
    manualPagination: true,
    enableSortingRemoval: false,
  });

  function change(patch: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }
  const filterCount = [
    filters.minCompetitors,
    filters.recommendation,
    filters.competitor,
    filters.maxSpam,
    filters.minRank,
    filters.evidence !== "any",
  ].filter(Boolean).length;

  const noRunYet = !gapQuery.isLoading && data === null;
  const openRow = data?.rows.find((row) => row.id === openId) ?? null;

  if (gapQuery.isError && !data) {
    return (
      <QueryError
        error={gapQuery.error}
        fallback="Failed to load the link gap"
        onRetry={() => void gapQuery.refetch()}
        isRetrying={gapQuery.isFetching}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Sites that link to your competitors but not to you. The provider
          reports counts per referring domain, so exact linking pages are read
          one site at a time.
        </p>
        <div className="flex gap-2">
          <QualificationSettings projectId={projectId} />
          {!noRunYet ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRun((o) => !o)}
            >
              <Plus data-icon="inline-start" /> New link gap
            </Button>
          ) : null}
        </div>
      </div>

      {noRunYet || showRun ? (
        <LinkGapRunPanel
          projectId={projectId}
          onDone={() => {
            setShowRun(false);
            setPage(1);
          }}
        />
      ) : null}

      {data ? (
        <p className="text-sm text-muted-foreground">
          Run for {data.run.targetDomain} against {data.competitors.join(", ")},
          read {formatCompactDate(data.run.createdAt)}.{" "}
          {data.run.linkStatus === "lost" ? "Lost links only. " : ""}
          {data.run.status === "partial" ? "Some reads failed. " : ""}
          {showCosts && data.run.costUsd !== null
            ? `Cost $${data.run.costUsd.toFixed(2)}. `
            : ""}
          Source: DataForSEO backlinks, domain intersection.
        </p>
      ) : null}

      {noRunYet ? null : (
        <DataTable
          table={table}
          isLoading={gapQuery.isLoading}
          isRefreshing={gapQuery.isFetching && !gapQuery.isLoading}
          isFiltered={filterCount > 0 || filters.search !== ""}
          onClearFilters={() => change(NO_FILTERS)}
          error={
            gapQuery.isError ? (
              <QueryError
                error={gapQuery.error}
                fallback="Failed to refresh the link gap"
                onRetry={() => void gapQuery.refetch()}
                isRetrying={gapQuery.isFetching}
              />
            ) : undefined
          }
          empty={{
            kind: "no-data",
            title: "No referring domains in this run",
            description:
              "The provider returned no sites linking to these competitors but not to you.",
          }}
          scrollClassName="max-h-[70vh]"
          onRowClick={(row, event) => {
            if (
              event.target instanceof HTMLElement &&
              event.target.closest("a,button,[role=checkbox]")
            )
              return;
            setOpenId(row.original.id);
          }}
          activeRowId={openId ?? undefined}
          toolbar={
            <>
              <DataTableToolbar
                actions={
                  <ExportMenu
                    actions={["csv", "excel", "json", "sheets"]}
                    disabled={!data || data.total === 0}
                    onExport={(action) => {
                      if (
                        action === "csv" ||
                        action === "excel" ||
                        action === "json" ||
                        action === "sheets"
                      )
                        void exportGap(projectId, query, action);
                    }}
                  />
                }
              >
                <Input
                  value={filters.search}
                  onChange={(event) => change({ search: event.target.value })}
                  placeholder="Search domains"
                  aria-label="Search domains"
                  className="h-8 w-48"
                />
                <DataTableFilterToggle
                  open={filtersOpen}
                  activeCount={filterCount}
                  onToggle={() => setFiltersOpen((open) => !open)}
                />
              </DataTableToolbar>
              {filtersOpen ? (
                <DataTableFilterPanel
                  activeCount={filterCount}
                  onReset={() => change(NO_FILTERS)}
                >
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Pick
                      label="Competitors linked"
                      value={String(filters.minCompetitors ?? ANY)}
                      items={[
                        { value: ANY, label: "Any number of competitors" },
                        { value: "2", label: "Links to 2 or more" },
                        { value: "3", label: "Links to 3 or more" },
                      ]}
                      onChange={(next) =>
                        change({
                          minCompetitors: next === ANY ? null : Number(next),
                        })
                      }
                    />
                    <Pick
                      label="Recommendation"
                      value={filters.recommendation ?? ANY}
                      items={[
                        { value: ANY, label: "Any recommendation" },
                        ...LINK_RECOMMENDATIONS.map((value) => ({
                          value,
                          label: recommendationLabel(value),
                        })),
                      ]}
                      onChange={(next) =>
                        change({
                          recommendation:
                            LINK_RECOMMENDATIONS.find((v) => v === next) ??
                            null,
                        })
                      }
                    />
                    <Pick
                      label="Competitor"
                      value={filters.competitor ?? ANY}
                      items={[
                        { value: ANY, label: "Any competitor" },
                        ...(data?.competitors ?? []).map((domain) => ({
                          value: domain,
                          label: domain,
                        })),
                      ]}
                      onChange={(next) =>
                        change({ competitor: next === ANY ? null : next })
                      }
                    />
                    <Pick
                      label="Exact pages"
                      value={filters.evidence}
                      items={[
                        { value: "any", label: "Any evidence" },
                        { value: "read", label: "Exact pages read" },
                        { value: "unread", label: "Exact pages not read" },
                      ]}
                      onChange={(next) =>
                        change({
                          evidence:
                            next === "read" || next === "unread" ? next : "any",
                        })
                      }
                    />
                    <DataTableRangeFilter
                      label="Domain Rank (0-1000)"
                      min={{
                        value: filters.minRank,
                        onChange: (e) => change({ minRank: e.target.value }),
                      }}
                      max={{ disabled: true }}
                    />
                    <DataTableRangeFilter
                      label="Spam score"
                      min={{ disabled: true }}
                      max={{
                        value: filters.maxSpam,
                        onChange: (e) => change({ maxSpam: e.target.value }),
                      }}
                    />
                  </div>
                </DataTableFilterPanel>
              ) : null}
            </>
          }
          footer={
            <TablePagination
              page={page}
              pageSize={pageSize}
              pageSizes={PAGE_SIZES}
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

      {data && data.total === 0 && filterCount === 0 && !filters.search ? (
        <EmptyState
          kind="no-data"
          title="No referring domains found"
          description="Nothing links to these competitors without also linking to you."
        />
      ) : null}

      <TableBulkActionBar
        selectedCount={selectedDomains.length}
        selectedLabel="sites"
        onClear={() => setSelection({})}
        actions={
          <div className="flex items-center px-2">
            <TableBulkActionButton
              onClick={() => save.mutate()}
              disabled={save.isPending}
            >
              Save as prospects
            </TableBulkActionButton>
          </div>
        }
      />

      <LinkCandidateSheet
        projectId={projectId}
        runId={data?.run.id ?? ""}
        row={openRow}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}

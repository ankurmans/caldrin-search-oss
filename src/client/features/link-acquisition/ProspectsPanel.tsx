/* eslint-disable max-lines, max-lines-per-function */
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  ColumnDef,
  RowSelectionState,
  SortingState,
} from "@tanstack/react-table";
import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { QueryError } from "@/client/components/QueryState";
import {
  DataTable,
  makeSelectionColumn,
  useDataTable,
  useSelectionAnchor,
} from "@/client/components/table/DataTable";
import { DataTableToolbar } from "@/client/components/table/DataTableToolbar";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import {
  TableBulkActionBar,
  TableBulkActionButton,
} from "@/client/components/table/TableBulkActionBar";
import { TablePagination } from "@/client/components/table/TablePagination";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { formatCompactDate } from "@/client/features/backlinks/backlinksPageUtils";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getAiCitedLinkSources,
  getLinkProspects,
  matchLinkProspectAssets,
  qualifyLinkProspects,
  saveLinkProspectManually,
  saveLinkProspectsFromAi,
  updateLinkProspects,
} from "@/serverFunctions/link-acquisition";
import {
  LINK_CAMPAIGN_MODE_LABELS,
  LINK_CAMPAIGN_MODES,
  LINK_DISCOVERY_METHOD_LABELS,
  LINK_PROSPECT_STATUS_LABELS,
  LINK_PROSPECT_STATUSES,
  type LinkProspectStatus,
} from "@/shared/link-acquisition";
import type { ProspectListQuery } from "@/types/schemas/link-acquisition";
import { DiscoverDialog } from "./DiscoverDialog";
import { ProspectSheet } from "./ProspectSheet";
import { prospectKeys, STATUS_VARIANT, type ProspectRow } from "./prospects";

const ANY = "any";
const PAGE_SIZES = [25, 50, 100] as const;
const SORT_FIELDS = [
  "updatedAt",
  "score",
  "dueDate",
  "referringDomain",
] as const;

function isSortField(id: string): id is ProspectListQuery["sortBy"] {
  return SORT_FIELDS.some((field) => field === id);
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
      <SelectTrigger size="sm" className="w-44" aria-label={label}>
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

function AddProspects({
  projectId,
  open,
  onOpenChange,
  onSaved,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [domain, setDomain] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const ai = useQuery({
    queryKey: prospectKeys.aiSources(projectId),
    enabled: open,
    queryFn: () => getAiCitedLinkSources({ data: { projectId } }),
  });
  const fail = (error: unknown) =>
    toast.error(getStandardErrorMessage(error, "Failed"));
  const manual = useMutation({
    mutationFn: () =>
      saveLinkProspectManually({
        data: {
          projectId,
          input: {
            domainOrUrl: domain,
            pageUrl: pageUrl.trim() || null,
            campaignMode: "earned_editorial",
          },
        },
      }),
    onSuccess: (result) => {
      if (!result.ok) return void toast.error(result.reason);
      toast.success(
        result.data.created ? "Prospect added" : "Already a prospect",
      );
      setDomain("");
      setPageUrl("");
      onSaved();
    },
    onError: fail,
  });
  const fromAi = useMutation({
    mutationFn: () =>
      saveLinkProspectsFromAi({
        data: {
          projectId,
          input: { domains: picked, campaignMode: "earned_editorial" },
        },
      }),
    onSuccess: (result) => {
      if (!result.ok) return void toast.error(result.reason);
      toast.success(`${result.data.created} added`);
      setPicked([]);
      onSaved();
    },
    onError: fail,
  });
  const sources = ai.data?.rows ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add prospects</DialogTitle>
          <DialogDescription>
            Competitor link gaps are saved from the Link Gap tab. Add a site you
            already know, or pick sites AI answers already cite.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">A site you know</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="example.com"
              aria-label="Domain"
            />
            <Input
              value={pageUrl}
              onChange={(event) => setPageUrl(event.target.value)}
              placeholder="Page URL (optional)"
              aria-label="Page URL"
            />
          </div>
          <Button
            size="sm"
            disabled={!domain.trim() || manual.isPending}
            onClick={() => manual.mutate()}
          >
            Add
          </Button>
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Sites AI answers cite</h3>
          <p className="text-xs text-muted-foreground">
            From stored AI answers for this project, last 90 days. Free to read.
          </p>
          {ai.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No cited third-party sites yet. Run an AI visibility check first.
            </p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2">
              {sources.map((source) => (
                <li key={source.domain}>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={picked.includes(source.domain)}
                      onChange={(event) =>
                        setPicked((current) =>
                          event.target.checked
                            ? [...current, source.domain]
                            : current.filter((d) => d !== source.domain),
                        )
                      }
                    />
                    <span className="min-w-0 flex-1 break-all">
                      {source.domain}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      cited in {source.citedAnswers}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button
            disabled={picked.length === 0 || fromAi.isPending}
            onClick={() => fromAi.mutate()}
          >
            Add {picked.length || ""} cited sites
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProspectsPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const anchor = useSelectionAnchor();
  const [status, setStatus] = useState<LinkProspectStatus | null>(null);
  const [mode, setMode] = useState<ProspectListQuery["campaignMode"]>();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "updatedAt", desc: true },
  ]);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [discovering, setDiscovering] = useState(false);

  const sort = sorting[0];
  const query = useMemo<ProspectListQuery>(
    () => ({
      status: status ?? undefined,
      campaignMode: mode,
      search: search.trim() || undefined,
      page,
      pageSize,
      sortBy: sort && isSortField(sort.id) ? sort.id : "updatedAt",
      sortDir: sort && !sort.desc ? "asc" : "desc",
    }),
    [status, mode, search, page, pageSize, sort],
  );
  const list = useQuery({
    queryKey: [...prospectKeys.list(projectId), query],
    queryFn: () => getLinkProspects({ data: { projectId, query } }),
    placeholderData: keepPreviousData,
  });
  const data = list.data;

  function refresh() {
    setSelection({});
    void queryClient.invalidateQueries({
      queryKey: prospectKeys.all(projectId),
    });
  }
  const fail = (error: unknown) =>
    toast.error(getStandardErrorMessage(error, "Failed"));
  const ids = Object.keys(selection).filter((id) => selection[id]);

  const bulkPatch = useMutation({
    mutationFn: (next: LinkProspectStatus) =>
      updateLinkProspects({
        data: { projectId, input: { ids, patch: { status: next } } },
      }),
    onSuccess: (result) => {
      if (!result.ok) return void toast.error(result.reason);
      toast.success(`${result.data.updated} updated`);
      refresh();
    },
    onError: fail,
  });
  const bulkQualify = useMutation({
    mutationFn: () =>
      qualifyLinkProspects({ data: { projectId, input: { ids } } }),
    onSuccess: (result) => {
      if (!result.ok) return void toast.error(result.reason);
      toast.success("Qualification updated from the current settings");
      refresh();
    },
    onError: fail,
  });
  const bulkMatch = useMutation({
    mutationFn: () =>
      matchLinkProspectAssets({ data: { projectId, input: { ids } } }),
    onSuccess: (result) => {
      if (!result.ok) return void toast.error(result.reason);
      toast.success("Page matches updated");
      refresh();
    },
    onError: fail,
  });

  const columns = useMemo<ColumnDef<ProspectRow>[]>(
    () => [
      makeSelectionColumn<ProspectRow>(
        anchor,
        (row) => `Select ${row.original.referringDomain}`,
      ),
      {
        id: "referringDomain",
        accessorKey: "referringDomain",
        header: ({ column }) => <SortableHeader column={column} label="Site" />,
        cell: ({ row }) => (
          <span className="font-medium break-all">
            {row.original.referringDomain}
          </span>
        ),
        meta: { cellClassName: "min-w-44" },
      },
      {
        id: "status",
        accessorKey: "status",
        enableSorting: false,
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={STATUS_VARIANT[row.original.status]}>
            {LINK_PROSPECT_STATUS_LABELS[row.original.status]}
          </Badge>
        ),
      },
      {
        id: "method",
        enableSorting: false,
        header: "Found by",
        cell: ({ row }) => LINK_DISCOVERY_METHOD_LABELS[row.original.method],
      },
      {
        id: "campaignMode",
        enableSorting: false,
        header: "Campaign",
        cell: ({ row }) => LINK_CAMPAIGN_MODE_LABELS[row.original.campaignMode],
      },
      {
        id: "score",
        accessorKey: "score",
        header: ({ column }) => (
          <SortableHeader column={column} label="Score" align="right" />
        ),
        cell: ({ row }) => row.original.score ?? "-",
        meta: {
          headerClassName: "text-right",
          cellClassName: "text-right tabular-nums",
        },
      },
      {
        id: "targetUrl",
        enableSorting: false,
        header: "Target page",
        cell: ({ row }) =>
          row.original.targetUrl ? (
            <span className="text-xs break-all">{row.original.targetUrl}</span>
          ) : (
            <span className="text-muted-foreground">None yet</span>
          ),
        meta: { cellClassName: "max-w-56" },
      },
      {
        id: "dueDate",
        accessorKey: "dueDate",
        header: ({ column }) => <SortableHeader column={column} label="Due" />,
        cell: ({ row }) =>
          row.original.dueDate ? formatCompactDate(row.original.dueDate) : "-",
      },
      {
        id: "updatedAt",
        accessorKey: "updatedAt",
        header: ({ column }) => (
          <SortableHeader column={column} label="Updated" />
        ),
        cell: ({ row }) => formatCompactDate(row.original.updatedAt),
      },
    ],
    [anchor],
  );

  const table = useDataTable<ProspectRow>({
    data: data?.rows ?? [],
    columns,
    getRowId: (row) => row.id,
    state: { sorting, rowSelection: selection },
    onSortingChange: (updater) => {
      setSorting(updater);
      setPage(1);
    },
    onRowSelectionChange: setSelection,
    enableRowSelection: true,
    manualSorting: true,
    manualPagination: true,
    enableSortingRemoval: false,
  });

  if (list.isError && !data) {
    return (
      <QueryError
        error={list.error}
        fallback="Failed to load prospects"
        onRetry={() => void list.refetch()}
        isRetrying={list.isFetching}
      />
    );
  }
  const counts = data?.counts ?? {};
  const openRow = data?.rows.find((row) => row.id === openId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Sites you have decided to work on, from the link gap, AI answers, or
          your own list. Each keeps its history, the page it should link to, and
          its campaign type. Sponsored placements stay separate from earned
          ones.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDiscovering(true)}
          >
            <Search data-icon="inline-start" /> Find recoverable links
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus data-icon="inline-start" /> Add prospects
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {LINK_PROSPECT_STATUSES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setStatus(status === value ? null : value);
              setPage(1);
            }}
            className="rounded-full"
            aria-pressed={status === value}
          >
            <Badge variant={status === value ? "default" : "outline"}>
              {LINK_PROSPECT_STATUS_LABELS[value]} {counts[value] ?? 0}
            </Badge>
          </button>
        ))}
      </div>

      <DataTable
        table={table}
        isLoading={list.isLoading}
        isRefreshing={list.isFetching && !list.isLoading}
        isFiltered={status !== null || mode !== undefined || search !== ""}
        onClearFilters={() => {
          setStatus(null);
          setMode(undefined);
          setSearch("");
        }}
        empty={{
          kind: "no-data",
          title: "No prospects yet",
          description:
            "Save sites from the Link Gap tab, or add one you already know.",
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
          <DataTableToolbar>
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search sites"
              aria-label="Search sites"
              className="h-8 w-48"
            />
            <Pick
              label="Campaign"
              value={mode ?? ANY}
              items={[
                { value: ANY, label: "Any campaign" },
                ...LINK_CAMPAIGN_MODES.map((value) => ({
                  value,
                  label: LINK_CAMPAIGN_MODE_LABELS[value],
                })),
              ]}
              onChange={(next) => {
                setMode(LINK_CAMPAIGN_MODES.find((value) => value === next));
                setPage(1);
              }}
            />
          </DataTableToolbar>
        }
        footer={
          <TablePagination
            page={page}
            pageSize={pageSize}
            pageSizes={PAGE_SIZES}
            totalCount={data?.total ?? null}
            isLoading={list.isFetching}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        }
      />

      <TableBulkActionBar
        selectedCount={ids.length}
        selectedLabel="prospects"
        onClear={() => setSelection({})}
        actions={
          <div className="flex items-center gap-1 px-2">
            <TableBulkActionButton
              onClick={() => bulkQualify.mutate()}
              disabled={bulkQualify.isPending}
            >
              Requalify
            </TableBulkActionButton>
            <TableBulkActionButton
              onClick={() => bulkMatch.mutate()}
              disabled={bulkMatch.isPending}
            >
              Match pages
            </TableBulkActionButton>
            <TableBulkActionButton
              onClick={() => bulkPatch.mutate("ready")}
              disabled={bulkPatch.isPending}
            >
              Mark ready
            </TableBulkActionButton>
            <TableBulkActionButton
              variant="danger"
              onClick={() => bulkPatch.mutate("rejected")}
              disabled={bulkPatch.isPending}
            >
              Reject
            </TableBulkActionButton>
          </div>
        }
      />

      <ProspectSheet
        projectId={projectId}
        row={openRow}
        onClose={() => setOpenId(null)}
      />
      <AddProspects
        projectId={projectId}
        open={adding}
        onOpenChange={setAdding}
        onSaved={refresh}
      />
      <DiscoverDialog
        projectId={projectId}
        open={discovering}
        onOpenChange={setDiscovering}
        onSaved={refresh}
      />
    </div>
  );
}

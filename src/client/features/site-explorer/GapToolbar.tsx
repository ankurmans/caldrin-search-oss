import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Table } from "@tanstack/react-table";
import { Columns3, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ExportMenu } from "@/client/components/ExportMenu";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  DataTableFilterPanel,
  DataTableFilterToggle,
  DataTableRangeFilter,
  DataTableToolbar,
} from "@/client/components/table/DataTableToolbar";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  deleteTableView,
  getSavedTableViews,
  saveTableView,
} from "@/serverFunctions/site-explorer";
import {
  GAP_INTENTS,
  GAP_KINDS,
  GAP_STATUSES,
} from "@/types/schemas/keyword-gap";
import { COLUMN_LABELS } from "./gapColumns";
import {
  gapKeys,
  INTENT_LABELS,
  KEYWORD_GAP_TABLE_KEY,
  KIND_LABELS,
  NO_FILTERS,
  STATUS_LABELS,
  type GapData,
  type GapFilterState,
  type GapRow,
} from "./gap";

function Pick<T extends string>({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: T;
  items: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <Select<T>
      items={items}
      value={value}
      onValueChange={(next) => {
        const found = items.find((item) => item.value === next);
        if (found) onChange(found.value);
      }}
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

const KIND_ITEMS = GAP_KINDS.map((value) => ({
  value,
  label: KIND_LABELS[value],
}));
const STATUS_ITEMS = GAP_STATUSES.map((value) => ({
  value,
  label: STATUS_LABELS[value],
}));
const ANY_INTENT = "any";
const INTENT_ITEMS = [
  { value: ANY_INTENT, label: "Any intent" },
  ...GAP_INTENTS.map((value) => ({ value, label: INTENT_LABELS[value] })),
];

type GapExportFormat = "csv" | "excel" | "json" | "sheets";

export function GapToolbar({
  projectId,
  table,
  data,
  filters,
  filterCount,
  filtersOpen,
  setFiltersOpen,
  changeFilters,
  applyView,
  exportAll,
  viewConfig,
}: {
  projectId: string;
  table: Table<GapRow>;
  data: GapData | null | undefined;
  filters: GapFilterState;
  filterCount: number;
  filtersOpen: boolean;
  setFiltersOpen: (update: (open: boolean) => boolean) => void;
  changeFilters: (patch: Partial<GapFilterState>) => void;
  applyView: (raw: string) => void;
  exportAll: (format: GapExportFormat) => Promise<void>;
  viewConfig: string;
}) {
  const queryClient = useQueryClient();
  const [viewName, setViewName] = useState("");
  const viewsQuery = useQuery({
    queryKey: gapKeys.views(projectId),
    queryFn: () =>
      getSavedTableViews({
        data: { projectId, tableKey: KEYWORD_GAP_TABLE_KEY },
      }),
  });
  const saveView = useMutation({
    mutationFn: () =>
      saveTableView({
        data: {
          projectId,
          tableKey: KEYWORD_GAP_TABLE_KEY,
          name: viewName,
          config: viewConfig,
        },
      }),
    onSuccess: () => {
      toast.success("View saved");
      setViewName("");
      void queryClient.invalidateQueries({
        queryKey: gapKeys.views(projectId),
      });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error, "Failed")),
  });
  const removeView = useMutation({
    mutationFn: (id: string) => deleteTableView({ data: { projectId, id } }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: gapKeys.views(projectId),
      }),
  });

  return (
    <>
      <DataTableToolbar
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" aria-label="Columns" />
                }
              >
                <Columns3 data-icon="inline-start" /> Columns
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                  {table
                    .getAllLeafColumns()
                    .filter((column) => column.id in COLUMN_LABELS)
                    .map((column) => (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        checked={column.getIsVisible()}
                        onCheckedChange={(next) =>
                          column.toggleVisibility(next)
                        }
                      >
                        {COLUMN_LABELS[column.id]}
                      </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <ExportMenu
              actions={["csv", "excel", "json", "sheets"]}
              disabled={!data || data.total === 0}
              onExport={(action) => {
                if (
                  action === "csv" ||
                  action === "excel" ||
                  action === "json" ||
                  action === "sheets"
                ) {
                  void exportAll(action);
                }
              }}
            />
          </>
        }
      >
        <Input
          value={filters.search}
          onChange={(event) => changeFilters({ search: event.target.value })}
          placeholder="Search keywords"
          aria-label="Search keywords"
          className="h-8 w-48"
        />
        <DataTableFilterToggle
          open={filtersOpen}
          activeCount={filterCount}
          onToggle={() => setFiltersOpen((open) => !open)}
        />
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            Saved views
            {viewsQuery.data?.length ? ` (${viewsQuery.data.length})` : ""}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuGroup>
              {viewsQuery.data?.length ? (
                viewsQuery.data.map((view) => (
                  <div key={view.id} className="flex items-center">
                    <DropdownMenuItem
                      className="flex-1"
                      onClick={() => applyView(view.config)}
                    >
                      {view.name}
                    </DropdownMenuItem>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Delete view ${view.name}`}
                      onClick={() => removeView.mutate(view.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))
              ) : (
                <DropdownMenuLabel>No saved views yet</DropdownMenuLabel>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <div
              className="flex gap-2 p-1.5"
              onKeyDown={(event) => event.stopPropagation()}
            >
              <Input
                value={viewName}
                onChange={(event) => setViewName(event.target.value)}
                placeholder="Name this view"
                aria-label="View name"
                className="h-7"
              />
              <Button
                size="xs"
                disabled={!viewName.trim() || saveView.isPending}
                onClick={() => saveView.mutate()}
              >
                <Save data-icon="inline-start" /> Save
              </Button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </DataTableToolbar>
      {filtersOpen ? (
        <DataTableFilterPanel
          activeCount={filterCount}
          onReset={() => changeFilters(NO_FILTERS)}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Pick
              label="Filter by type"
              value={filters.kind}
              items={KIND_ITEMS}
              onChange={(kind) => changeFilters({ kind })}
            />
            <Pick
              label="Filter by status"
              value={filters.status}
              items={STATUS_ITEMS}
              onChange={(status) => changeFilters({ status })}
            />
            <Pick
              label="Filter by intent"
              value={filters.intent ?? ANY_INTENT}
              items={INTENT_ITEMS}
              onChange={(intent) =>
                changeFilters({
                  intent: GAP_INTENTS.find((value) => value === intent) ?? null,
                })
              }
            />
            <Pick
              label="Filter by competitor"
              value={filters.competitor ?? ANY_INTENT}
              items={[
                { value: ANY_INTENT, label: "Any competitor" },
                ...[
                  ...new Set(
                    (data?.competitors ?? []).map(
                      (competitor) => competitor.competitorDomain,
                    ),
                  ),
                ].map((domain) => ({ value: domain, label: domain })),
              ]}
              onChange={(competitor) =>
                changeFilters({
                  competitor: competitor === ANY_INTENT ? null : competitor,
                })
              }
            />
            <DataTableRangeFilter
              label="Volume"
              min={{
                value: filters.minVolume,
                onChange: (event) =>
                  changeFilters({ minVolume: event.target.value }),
              }}
              max={{
                value: filters.maxVolume,
                onChange: (event) =>
                  changeFilters({ maxVolume: event.target.value }),
              }}
            />
            <DataTableRangeFilter
              label="Difficulty"
              min={{
                value: filters.minKd,
                onChange: (event) =>
                  changeFilters({ minKd: event.target.value }),
              }}
              max={{
                value: filters.maxKd,
                onChange: (event) =>
                  changeFilters({ maxKd: event.target.value }),
              }}
            />
            <Input
              type="number"
              min={1}
              max={5}
              value={filters.minCompetitors}
              onChange={(event) =>
                changeFilters({ minCompetitors: event.target.value })
              }
              placeholder="Min competitors ranking"
              aria-label="Minimum competitors ranking"
              className="h-7"
            />
          </div>
        </DataTableFilterPanel>
      ) : null}
    </>
  );
}

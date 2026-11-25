import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/client/components/PageHeader";
import { NavTab, NavTabs } from "@/client/components/NavTabs";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Switch } from "@/client/components/ui/switch";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { setAttributionDemoFn } from "@/serverFunctions/attributionReports";
import { RANGE_KEYS, RANGE_LABELS } from "@/shared/attribution/ranges";
import {
  MODEL_KEYS,
  MODEL_LABELS,
  narrow,
} from "@/shared/attribution/vocabulary";
import type { AttributionPageSearch } from "@/types/schemas/attribution";
import { EvidenceDrawer } from "./EvidenceDrawer";
import { HealthView } from "./HealthView";
import { LeadsView } from "./LeadsView";
import { JourneysView } from "./JourneysView";
import { OverviewView } from "./OverviewView";
import { SearchAiView } from "./SearchAiView";
import { attributionKey, useAttributionSetup } from "./useAttributionSetup";

const VIEWS = [
  { value: "overview", label: "Overview" },
  { value: "journeys", label: "Journeys" },
  { value: "search", label: "Search & AI" },
  { value: "leads", label: "Leads & Revenue" },
  { value: "health", label: "Attribution Health" },
] as const;

const DEFAULT_MODEL_ITEM = "default";
const ALL_BRANDS_ITEM = "all";

/** Revenue Intelligence: where signups, leads and revenue came from, and how sure we are. */
export function AttributionPage({
  projectId,
  search,
  onSearchChange,
}: {
  projectId: string;
  search: AttributionPageSearch;
  onSearchChange: (update: Partial<AttributionPageSearch>) => void;
}) {
  const queryClient = useQueryClient();
  const { query: setup } = useAttributionSetup(projectId);
  const view = search.view ?? "overview";
  const range = search.range ?? "28d";
  const showDemo = search.demo ?? false;
  const brandId = setup.data?.brands.find((b) => b.id === search.brand)?.id;
  const params = {
    projectId,
    range,
    model: search.model,
    demo: showDemo,
    brandId,
  };
  const modelItems = [
    {
      value: DEFAULT_MODEL_ITEM,
      label: `Project default${setup.data ? ` (${MODEL_LABELS[narrow(MODEL_KEYS, setup.data.settings.defaultModel) ?? "last_non_direct"]})` : ""}`,
    },
    ...MODEL_KEYS.map((m) => ({ value: m, label: MODEL_LABELS[m] })),
  ];

  const demo = useMutation({
    // Turning the switch on adds the demo data if it is not there yet; the
    // switch off only hides it, and "Remove" deletes it.
    mutationFn: (action: "show" | "remove") =>
      setAttributionDemoFn({
        data: { projectId, demo: action === "show" },
      }),
    onSuccess: async (_result, action) => {
      await queryClient.invalidateQueries({
        queryKey: attributionKey(projectId),
      });
      onSearchChange({ demo: action === "show" });
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not change demo data")),
  });

  const noWebsite = setup.data && setup.data.properties.length === 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
      <PageHeader
        title="Revenue Intelligence"
        description="Which sources lead to signups, leads and revenue, and how well each answer is supported."
        actions={
          <>
            <Select
              items={RANGE_KEYS.map((r) => ({
                value: r,
                label: RANGE_LABELS[r],
              }))}
              value={range}
              onValueChange={(v) => {
                const picked = RANGE_KEYS.find((r) => r === v);
                if (picked) onSearchChange({ range: picked });
              }}
            >
              <SelectTrigger size="sm" className="w-40" aria-label="Date range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_KEYS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {RANGE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              items={modelItems}
              value={search.model ?? DEFAULT_MODEL_ITEM}
              onValueChange={(v) =>
                onSearchChange({ model: MODEL_KEYS.find((m) => m === v) })
              }
            >
              <SelectTrigger
                size="sm"
                className="w-64"
                aria-label="Attribution model"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modelItems.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {setup.data?.brands.length ? (
              <Select
                items={[
                  { value: ALL_BRANDS_ITEM, label: "All brands" },
                  ...setup.data.brands.map((b) => ({
                    value: b.id,
                    label: b.name,
                  })),
                ]}
                value={brandId ?? ALL_BRANDS_ITEM}
                onValueChange={(v) =>
                  onSearchChange({
                    brand: v && v !== ALL_BRANDS_ITEM ? v : undefined,
                  })
                }
              >
                <SelectTrigger size="sm" className="w-44" aria-label="Brand">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_BRANDS_ITEM}>All brands</SelectItem>
                  {setup.data.brands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <Switch
                size="sm"
                checked={showDemo}
                disabled={demo.isPending}
                onCheckedChange={(on) =>
                  on ? demo.mutate("show") : onSearchChange({ demo: false })
                }
                aria-label="Show demo data"
              />
              Demo data
            </label>
          </>
        }
      />

      {noWebsite ? (
        <Alert>
          <AlertTitle>No website is connected yet</AlertTitle>
          <AlertDescription>
            Register a website and install the tracker in{" "}
            <Link
              to="/p/$projectId/settings/integrations"
              params={{ projectId }}
              hash="revenue-attribution"
              className="underline"
            >
              Project Settings, Integrations
            </Link>
            . Until then only imported or backend-reported outcomes appear here.
          </AlertDescription>
        </Alert>
      ) : null}

      {showDemo ? (
        <Alert>
          <AlertTitle>Showing labelled demo data</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            Everything below is invented for illustration and is kept apart from
            your real data.
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSearchChange({ demo: false })}
            >
              Hide
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={demo.isPending}
              onClick={() => demo.mutate("remove")}
            >
              Remove demo data
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <NavTabs label="Revenue Intelligence views">
        {VIEWS.map((v) => (
          <NavTab
            key={v.value}
            to="/p/$projectId/attribution"
            params={{ projectId }}
            search={{
              ...search,
              view: v.value,
              conversion: undefined,
              page: undefined,
            }}
            active={view === v.value}
          >
            {v.label}
          </NavTab>
        ))}
      </NavTabs>

      {view === "overview" ? <OverviewView params={params} /> : null}
      {view === "journeys" ? (
        <JourneysView
          params={params}
          onOpen={(conversion) => onSearchChange({ conversion })}
        />
      ) : null}
      {view === "search" ? (
        <SearchAiView
          params={params}
          page={search.page}
          onPage={(page) => onSearchChange({ page })}
        />
      ) : null}
      {view === "leads" ? (
        <LeadsView
          params={params}
          onOpen={(conversion) => onSearchChange({ conversion })}
        />
      ) : null}
      {view === "health" ? (
        <HealthView projectId={projectId} demo={showDemo} />
      ) : null}

      <EvidenceDrawer
        projectId={projectId}
        conversionId={search.conversion}
        onClose={() => onSearchChange({ conversion: undefined })}
      />
    </div>
  );
}

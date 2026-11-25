import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Globe, Plus, X } from "lucide-react";
import { LocationSelect } from "@/client/components/LocationSelect";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { isSameSite } from "@/client/features/domain/siteExplorerDomain";
import { LABS_LOCATION_OPTIONS } from "@/client/features/keywords/locations";
import { SearchTabStatus } from "@/client/features/search-tabs/SearchTabStrip";
import type { SearchTab } from "@/client/features/search-tabs/types";
import { gapKeys } from "@/client/features/site-explorer/gap";
import { cn } from "cn";
import { getSavedCompetitors } from "@/serverFunctions/site-explorer";

type Props = {
  projectId: string;
  /** The project's own hostname, or "" when it has none. */
  ownDomain: string;
  ownSelected: boolean;
  /** Domains opened for research, never including the project's own. */
  researchTabs: SearchTab[];
  activeTabId: string | null;
  locationCode: number;
  addOpen: boolean;
  onSelectOwn: () => void;
  onSelectTab: (tab: SearchTab) => void;
  onCloseTab: (tabId: string) => void;
  onViewedTab: (tabId: string, when?: number) => void;
  onSelectSaved: (domain: string) => void;
  onToggleAdd: () => void;
  onLocationChange: (locationCode: number) => void;
};

const chip =
  "flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors";

/**
 * The domains being explored. The project's own site is always first and never
 * closes; every other domain is research and can be removed without touching
 * the project. Saved competitors open directly from the menu.
 */
export function DomainBar({
  projectId,
  ownDomain,
  ownSelected,
  researchTabs,
  activeTabId,
  locationCode,
  addOpen,
  onSelectOwn,
  onSelectTab,
  onCloseTab,
  onViewedTab,
  onSelectSaved,
  onToggleAdd,
  onLocationChange,
}: Props) {
  const savedQuery = useQuery({
    queryKey: gapKeys.competitors(projectId),
    queryFn: () => getSavedCompetitors({ data: { projectId } }),
    staleTime: 60_000,
  });
  const savedDomains =
    savedQuery.data?.map((competitor) => competitor.domain) ?? [];
  const isSaved = (domain: string) =>
    savedDomains.some((value) => isSameSite(value, domain));
  const unopened = savedDomains.filter(
    (domain) =>
      !isSameSite(domain, ownDomain) &&
      !researchTabs.some(
        (tab) =>
          tab.input.type === "domain" && isSameSite(tab.input.domain, domain),
      ),
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {ownDomain ? (
        <button
          type="button"
          aria-pressed={ownSelected}
          onClick={onSelectOwn}
          className={cn(
            chip,
            ownSelected
              ? "border-primary bg-primary/10 font-medium text-foreground"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          <Globe className="size-3.5" />
          <span className="max-w-[14rem] truncate">{ownDomain}</span>
          <Badge variant="secondary">Your site</Badge>
        </button>
      ) : null}

      {researchTabs.map((tab) => {
        const active = tab.id === activeTabId && !ownSelected;
        const saved = tab.input.type === "domain" && isSaved(tab.input.domain);
        return (
          <div
            key={tab.id}
            className={cn(
              chip,
              "gap-1 pr-1",
              active
                ? "border-foreground/40 bg-muted font-medium text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <button
              type="button"
              aria-pressed={active}
              className="flex items-center gap-1.5"
              onClick={() => onSelectTab(tab)}
            >
              <SearchTabStatus
                tab={tab}
                projectId={projectId}
                active={active}
                onViewed={onViewedTab}
              />
              <span className="max-w-[12rem] truncate" title={tab.label}>
                {tab.label}
              </span>
              {saved ? (
                <Check
                  className="size-3.5 text-muted-foreground"
                  aria-label="Saved competitor"
                />
              ) : null}
            </button>
            <button
              type="button"
              className="rounded-full p-1 opacity-60 hover:bg-foreground/10 hover:opacity-100"
              aria-label={`Remove ${tab.label} from this comparison`}
              onClick={() => onCloseTab(tab.id)}
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}

      {unopened.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="sm" className="rounded-full" />
            }
          >
            Saved competitors <ChevronDown data-icon="inline-end" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {unopened.map((domain) => (
              <DropdownMenuItem
                key={domain}
                onClick={() => onSelectSaved(domain)}
              >
                {domain}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <Button
        variant="ghost"
        size="sm"
        className="rounded-full"
        aria-expanded={addOpen}
        onClick={onToggleAdd}
      >
        <Plus data-icon="inline-start" /> Add domain
      </Button>

      <div className="ml-auto w-full sm:w-44">
        <LocationSelect
          value={locationCode}
          options={LABS_LOCATION_OPTIONS}
          onChange={onLocationChange}
        />
      </div>
    </div>
  );
}

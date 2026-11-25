import { useQuery } from "@tanstack/react-query";
import { getClaimsAvailability } from "@/serverFunctions/ai-claims";
import { useLocation } from "@tanstack/react-router";
import { NavTab, NavTabs } from "@/client/components/NavTabs";
import { SiteExplorerNav } from "@/client/components/SiteExplorerNav";
import { activeHubTab, hubForPath } from "@/client/navigation/hubs";

/** Links to the other pages of the workspace the current page belongs to. */
export function HubNav({ projectId }: { projectId: string }) {
  const { pathname } = useLocation();
  const hub = hubForPath(pathname, projectId);
  const showClaims = useQuery({
    queryKey: ["claims-availability", projectId],
    queryFn: () => getClaimsAvailability({ data: { projectId } }),
    enabled:
      hub?.tabs.some((tab) => tab.to.endsWith("/ai-visibility/claims")) ===
      true,
    staleTime: 60_000,
  });
  if (!hub) return null;
  if (hub.custom === "site-explorer")
    return <SiteExplorerNav projectId={projectId} />;
  const active = activeHubTab(hub.tabs, pathname, projectId);
  return (
    <div className="space-y-2 overflow-x-auto px-4 pt-3 md:px-6">
      <NavTabs label={`${hub.label} sections`}>
        {hub.tabs
          .filter(
            (tab) =>
              !tab.to.endsWith("/ai-visibility/claims") || showClaims.data,
          )
          .map((tab) => (
            <NavTab
              key={tab.to}
              to={tab.to}
              params={{ projectId }}
              active={tab === active}
              className="whitespace-nowrap"
            >
              {tab.label}
            </NavTab>
          ))}
      </NavTabs>
      {active?.views ? (
        <nav
          aria-label={`${active.label} pages`}
          className="flex gap-1.5 text-sm"
        >
          {active.views.map((view) => (
            <NavTab
              key={view.to}
              to={view.to}
              params={{ projectId }}
              activeOptions={{ exact: view.exact ?? false }}
              className="h-7 rounded-full border px-3 text-xs after:hidden data-[status=active]:border-foreground data-[status=active]:bg-muted"
            >
              {view.label}
            </NavTab>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

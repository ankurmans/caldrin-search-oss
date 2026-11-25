import { useLocation, useSearch } from "@tanstack/react-router";
import { NavTab, NavTabs } from "@/client/components/NavTabs";
import { researchScopeSchema } from "@/shared/researchScope";
import { isSameSite } from "@/client/features/domain/siteExplorerDomain";
import { useProjectMarket } from "@/client/features/projects/useProjectMarket";
import { activeSiteExplorerTab } from "@/client/navigation/siteExplorerTabs";

/**
 * The single Site Explorer navigation. Overview, Organic and AI Mentions are views of the explored domain; Competitors and Keyword Gap open
 * the project's own pages. The explored domain and market travel with the tabs.
 */
export function SiteExplorerNav({ projectId }: { projectId: string }) {
  const { pathname } = useLocation();
  const search: Record<string, unknown> = useSearch({ strict: false });
  const project = useProjectMarket(projectId);
  const active = activeSiteExplorerTab(pathname, projectId, search);

  const onDomainPage = pathname === `/p/${projectId}/domain`;
  const domain =
    onDomainPage && typeof search.domain === "string" ? search.domain : "";
  const isOwn = domain === "" || isSameSite(domain, project?.domain);
  const loc =
    onDomainPage && typeof search.loc === "number" ? search.loc : undefined;
  const scope = onDomainPage
    ? researchScopeSchema.safeParse(search.scope).data
    : undefined;
  // The project's own site is the default, so it never appears in the URL.
  const carry = {
    domain: isOwn ? undefined : domain,
    scope: isOwn ? undefined : scope,
    loc,
  };
  const params = { projectId };

  return (
    <div className="overflow-x-auto px-4 pt-3 md:px-6">
      <NavTabs label="Site Explorer sections">
        <NavTab
          to="/p/$projectId/domain"
          params={params}
          search={carry}
          active={active === "overview"}
          className="whitespace-nowrap"
        >
          Overview
        </NavTab>
        <NavTab
          to="/p/$projectId/domain"
          params={params}
          search={{ ...carry, view: "organic" }}
          active={active === "organic"}
          className="whitespace-nowrap"
        >
          Organic
        </NavTab>
        <NavTab
          to="/p/$projectId/domain"
          params={params}
          search={{ ...carry, view: "ai" }}
          active={active === "ai"}
          className="whitespace-nowrap"
        >
          AI Mentions
        </NavTab>
        {isOwn ? (
          <NavTab
            to="/p/$projectId/competitors"
            params={params}
            active={active === "competitors"}
            className="whitespace-nowrap"
          >
            Competitors
          </NavTab>
        ) : (
          <NavTab
            to="/p/$projectId/domain"
            params={params}
            search={{ ...carry, view: "competitors" }}
            active={active === "competitors"}
            className="whitespace-nowrap"
          >
            Competitors
          </NavTab>
        )}
        <NavTab
          to="/p/$projectId/keyword-gap"
          params={params}
          active={active === "keyword-gap"}
          className="whitespace-nowrap"
        >
          Keyword Gap
        </NavTab>
      </NavTabs>
    </div>
  );
}

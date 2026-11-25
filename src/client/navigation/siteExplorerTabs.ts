import { defaultView } from "@/client/features/domain/domainRouteState";
import { DOMAIN_VIEWS, domainSearchSchema } from "@/types/schemas/domain";

type SiteExplorerTab =
  | "overview"
  | "organic"
  | "backlinks"
  | "competitors"
  | "keyword-gap"
  | "ai";

/**
 * The one Site Explorer navigation row spans four routes plus the views of the
 * domain page. This maps where the person is to the tab that should light up.
 */
export function activeSiteExplorerTab(
  pathname: string,
  projectId: string,
  rawSearch: unknown,
): SiteExplorerTab {
  const base = `/p/${projectId}`;
  if (pathname.startsWith(`${base}/keyword-gap`)) return "keyword-gap";
  if (pathname.startsWith(`${base}/competitors`)) return "competitors";
  if (pathname.startsWith(`${base}/brand-lookup`)) return "ai";
  const search = domainSearchSchema.safeParse(rawSearch);
  if (!search.success) return "overview";
  const view = search.data.view ?? defaultView(search.data);
  return DOMAIN_VIEWS.includes(view) ? view : "overview";
}

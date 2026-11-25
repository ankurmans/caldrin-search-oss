import type {
  getLinkOutreach,
  getLinkPlacements,
  getLinkProspects,
} from "@/serverFunctions/link-acquisition";
import type { LinkProspectStatus } from "@/shared/link-acquisition";

export type ProspectsData = NonNullable<
  Awaited<ReturnType<typeof getLinkProspects>>
>;
export type ProspectRow = ProspectsData["rows"][number];
export type OutreachData = Awaited<ReturnType<typeof getLinkOutreach>>;
export type DraftRow = OutreachData["drafts"][number];
export type PlacementsData = Awaited<ReturnType<typeof getLinkPlacements>>;
export type PlacementRow = PlacementsData["placements"][number];

export const prospectKeys = {
  all: (projectId: string) => ["linkProspects", projectId] as const,
  list: (projectId: string) => ["linkProspects", projectId, "list"] as const,
  outreach: (projectId: string) => ["linkOutreach", projectId] as const,
  placements: (projectId: string) => ["linkPlacements", projectId] as const,
  aiSources: (projectId: string) => ["linkAiSources", projectId] as const,
};

export const STATUS_VARIANT: Record<
  LinkProspectStatus,
  "outline" | "info" | "soft" | "success" | "destructive"
> = {
  discovered: "outline",
  qualified: "info",
  ready: "info",
  outreach_approved: "soft",
  contacted: "soft",
  responded: "soft",
  acquired: "success",
  rejected: "outline",
  lost: "destructive",
};

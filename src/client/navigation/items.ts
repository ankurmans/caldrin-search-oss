import {
  Bell,
  CircleDollarSign,
  Bot,
  ClipboardCheck,
  FileText,
  Globe,
  History,
  LayoutDashboard,
  Link2,
  MapPin,
  PenLine,
  Search,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { linkOptions } from "@tanstack/react-router";

// Each item opens one workspace. `alsoActive` lists the other project routes
// that live inside that workspace, so the item stays highlighted on them. The
// routes themselves are unchanged, so every old URL still opens.
const projectNavItems = [
  {
    to: "/p/$projectId" as const,
    label: "Dashboard",
    icon: LayoutDashboard,
    // Without exact matching, the index path is a prefix of every project
    // route and this item would render active everywhere.
    activeOptions: { exact: true, includeSearch: false },
  },
  {
    to: "/p/$projectId/keywords" as const,
    label: "Keywords & SERPs",
    icon: Search,
    alsoActive: ["saved"],
  },
  {
    to: "/p/$projectId/domain" as const,
    label: "Site Explorer",
    icon: Globe,
    alsoActive: ["keyword-gap", "competitors", "brand-lookup"],
  },
  {
    to: "/p/$projectId/backlinks" as const,
    label: "Backlinks",
    icon: Link2,
  },
  {
    to: "/p/$projectId/search-performance" as const,
    label: "Organic Search",
    icon: TrendingUp,
    alsoActive: ["rank-tracking"],
  },
  {
    to: "/p/$projectId/ai-visibility/insights" as const,
    label: "AI Search",
    icon: Sparkles,
    alsoActive: ["ai-visibility", "prompt-explorer"],
  },
  {
    to: "/p/$projectId/local-seo" as const,
    label: "Local Search",
    icon: MapPin,
  },
  {
    to: "/p/$projectId/audit" as const,
    label: "Technical SEO",
    icon: ClipboardCheck,
    alsoActive: ["technical"],
  },
  {
    to: "/p/$projectId/opportunities" as const,
    label: "Opportunities",
    icon: Target,
  },
  {
    to: "/p/$projectId/content" as const,
    label: "Content Studio",
    icon: PenLine,
  },
  {
    to: "/p/$projectId/changes" as const,
    label: "Workflows & Changes",
    icon: History,
  },
  {
    to: "/p/$projectId/reports" as const,
    label: "Reports",
    icon: FileText,
  },
  {
    to: "/p/$projectId/attribution" as const,
    label: "Attribution",
    icon: CircleDollarSign,
  },
  {
    to: "/p/$projectId/alerts" as const,
    label: "Alerts",
    icon: Bell,
  },
  {
    to: "/p/$projectId/settings" as const,
    label: "Project Settings",
    icon: Settings,
    // Context lives under settings now; its old URL still opens.
    alsoActive: ["context"],
  },
] as const;

// Project-independent. Rendered in the project's Workspace group when a
// project is selected, and on its own (connectNavGroup) when none is.
const aiNavItem = linkOptions({
  to: "/ai" as const,
  label: "Agent setup",
  icon: Bot,
});

// Shown only when no project is selected; with a project, Agent setup lives in
// the Workspace group below.
export const connectNavGroup = {
  label: "AI Tools",
  items: [aiNavItem],
};

function getProjectNavItems(projectId: string) {
  return linkOptions(
    projectNavItems.map((item) => ({
      ...item,
      alsoActive: "alsoActive" in item ? item.alsoActive : [],
      params: { projectId },
      search: {},
    })),
  );
}

// Grouped by the job being done: look at the whole picture, research a market,
// monitor what is measured, act on what was found, and run the workspace.
export function getProjectNavGroups(projectId: string) {
  const all = getProjectNavItems(projectId);
  const byPath = (path: (typeof projectNavItems)[number]["to"]) =>
    all.find((i) => i.to === path)!;

  return [
    {
      label: "Overview",
      items: [byPath("/p/$projectId")],
    },
    {
      label: "Research",
      items: [
        byPath("/p/$projectId/keywords"),
        byPath("/p/$projectId/domain"),
        byPath("/p/$projectId/backlinks"),
      ],
    },
    {
      label: "Monitor",
      items: [
        byPath("/p/$projectId/search-performance"),
        byPath("/p/$projectId/ai-visibility/insights"),
        byPath("/p/$projectId/local-seo"),
        byPath("/p/$projectId/audit"),
        byPath("/p/$projectId/attribution"),
      ],
    },
    {
      label: "Act",
      items: [
        byPath("/p/$projectId/opportunities"),
        byPath("/p/$projectId/content"),
        byPath("/p/$projectId/changes"),
      ],
    },
    {
      label: "Workspace",
      items: [
        byPath("/p/$projectId/reports"),
        byPath("/p/$projectId/alerts"),
        byPath("/p/$projectId/settings"),
        aiNavItem,
      ],
    },
  ];
}

export const dataforseoHelpLinkOptions = linkOptions({
  to: "/help/dataforseo-api-key",
});

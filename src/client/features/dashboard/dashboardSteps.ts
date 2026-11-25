import {
  Bot,
  ChartLine,
  Eye,
  Link2,
  Plug,
  Radio,
  Sparkles,
  ClipboardCheck,
  FolderPlus,
  Globe,
  Lightbulb,
  Users,
} from "lucide-react";
import type { DashboardActivation } from "@/server/features/dashboard/services/DashboardService";
import type { DashboardSetupStep } from "@/types/schemas/dashboard";

export const setupSteps: {
  id: DashboardSetupStep;
  label: string;
  detail: string;
  icon: typeof Globe;
  skipLabel: string;
  more?: boolean;
}[] = [
  {
    id: "google",
    label: "Connect Google",
    detail: "Use your Search Console and Analytics data.",
    icon: Link2,
    skipLabel: "Skip for now",
  },
  {
    id: "first_read",
    label: "View your first read",
    detail: "See findings backed by data from your site.",
    icon: Eye,
    skipLabel: "Skip for now",
  },
  {
    id: "rank_tracker",
    label: "Create a rank tracker",
    detail: "Follow changes to keyword positions over time.",
    icon: ChartLine,
    skipLabel: "Skip for now",
  },
  {
    id: "baseline",
    label: "Run an AI visibility baseline",
    detail: "See where AI answers mention or cite your site.",
    icon: Sparkles,
    skipLabel: "Skip for now",
  },
  {
    id: "connector",
    label: "Connect Shopify",
    detail: "Use the project’s store connection for approved changes.",
    icon: Plug,
    skipLabel: "Skip for now",
  },
  {
    id: "tracker",
    label: "Install the website tracker",
    detail: "Record visits from your website after consent.",
    icon: Radio,
    skipLabel: "Skip for now",
  },
  {
    id: "competitor",
    more: true,
    label: "Explore a competitor",
    detail: "Find topics and links worth learning from.",
    icon: Globe,
    skipLabel: "Skip for now",
  },
  {
    id: "keywords",
    more: true,
    label: "Get keyword ideas",
    detail: "Start from one keyword and see what people search for.",
    icon: Lightbulb,
    skipLabel: "Skip for now",
  },
  {
    id: "audit",
    more: true,
    label: "Audit your site",
    detail: "Crawl for broken links, missing tags, and indexability problems.",
    icon: ClipboardCheck,
    skipLabel: "Skip for now",
  },
  {
    id: "mcp",
    label: "Connect your AI agent",
    detail: "Use Caldrin Search inside Claude or your favorite agent.",
    icon: Bot,
    skipLabel: "Skip for now",
  },
  {
    id: "team",
    more: true,
    label: "Invite a teammate",
    detail: "Share the work, or keep things solo for now.",
    icon: Users,
    skipLabel: "Skip",
  },
  {
    id: "project",
    more: true,
    label: "Working on multiple websites?",
    detail:
      "Create another project, or let your AI agent set up a list of sites.",
    icon: FolderPlus,
    skipLabel: "I only need one project",
  },
];

export function getStepStatus(
  activation: DashboardActivation,
  step: DashboardSetupStep,
): "done" | "skipped" | "todo" {
  const completed: Record<DashboardSetupStep, boolean> = {
    google: activation.gsc.connected && activation.ga4.connected,
    first_read: activation.onboarding.firstReadViewed,
    rank_tracker: activation.onboarding.rankTracker,
    baseline: activation.onboarding.baseline,
    connector: activation.onboarding.connector,
    tracker: activation.onboarding.tracker,
    competitor: activation.competitorResearchedAt !== null,
    keywords: activation.keywordsResearchedAt !== null,
    audit: activation.hasAudit,
    mcp:
      activation.mcp.authorizedAt !== null ||
      activation.mcp.firstToolCallAt !== null,
    team: activation.hasTeammate,
    project: activation.hasMultipleProjects,
  };
  if (completed[step]) return "done";
  if (!activation.dismissedSteps.includes(step)) return "todo";
  return completeWhenSkipped.has(step) ? "done" : "skipped";
}

// Skipping these marks them complete, so they never wait in "saved for later".
const completeWhenSkipped = new Set<DashboardSetupStep>(["team", "project"]);

export function orderedSetupSteps(
  activation: DashboardActivation,
  hasAccounts: boolean,
) {
  const goal = activation.onboarding.goal;
  const preferred =
    goal === "agent"
      ? "mcp"
      : goal === "links"
        ? "tracker"
        : goal === "content"
          ? "baseline"
          : "rank_tracker";
  const steps = setupSteps
    .filter(
      ({ id, more }) =>
        (id !== "team" || hasAccounts) &&
        (Boolean(activation.domain) || more || id === "mcp") &&
        (id !== "connector" ||
          (activation.onboarding.firstReadViewed &&
            (activation.onboarding.platform === "shopify" ||
              activation.onboarding.connector))) &&
        (id !== "tracker" || activation.onboarding.firstReadViewed),
    )
    .map((step) =>
      step.id === "connector" && activation.onboarding.platform !== "shopify"
        ? {
            ...step,
            label: "Connect a site integration",
            detail: "Connect the site through an approved integration.",
          }
        : step,
    );
  // Google and the first read stay first. The goal moves a relevant action
  // up within the remaining steps without changing anyone's completion.
  const index = steps.findIndex((step) => step.id === preferred);
  const insertion = steps.filter(
    (step) => step.id === "google" || step.id === "first_read",
  ).length;
  if (index < insertion) return steps;
  const [step] = steps.splice(index, 1);
  steps.splice(insertion, 0, step);
  return steps;
}

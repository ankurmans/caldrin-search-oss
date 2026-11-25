import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { usesBetterAuthClient } from "@/lib/auth-mode";
import {
  DashboardOnboarding,
  readHidden,
} from "@/client/features/dashboard/DashboardOnboarding";
import {
  getStepStatus,
  orderedSetupSteps,
} from "@/client/features/dashboard/dashboardSteps";
import type { DashboardActivation } from "@/server/features/dashboard/services/DashboardService";

/**
 * One line while setup is unfinished, from the connections that actually
 * exist. The full checklist opens from it, so it no longer sits above the
 * data it is meant to unlock.
 */
export function SetupStrip({
  projectId,
  activation,
}: {
  projectId: string;
  activation: DashboardActivation;
}) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(() => readHidden(projectId));
  const all = orderedSetupSteps(activation, usesBetterAuthClient());
  const steps = all.filter((step) => !step.more);
  if (
    hidden ||
    !all.some((step) => getStepStatus(activation, step.id) !== "done")
  )
    return null;
  const next = steps.find(
    (step) => getStepStatus(activation, step.id) === "todo",
  );
  const done = steps.filter(
    (step) => getStepStatus(activation, step.id) === "done",
  ).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card px-3 py-2 text-sm">
        <span className="font-medium">
          Setup {done} of {steps.length}
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {next ? "Next: " + next.label : "More setup options"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Hide steps" : "Show steps"}
          <ChevronDown className={open ? "rotate-180" : ""} />
        </Button>
      </div>
      {open ? (
        <DashboardOnboarding
          projectId={projectId}
          activation={activation}
          onHide={() => setHidden(true)}
        />
      ) : null}
    </div>
  );
}

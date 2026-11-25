import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, RotateCcw, X } from "lucide-react";
import { usesBetterAuthClient } from "@/lib/auth-mode";
import { captureClientEvent } from "@/client/lib/posthog";
import { setDashboardStepDismissed } from "@/serverFunctions/dashboard";
import type { DashboardActivation } from "@/server/features/dashboard/services/DashboardService";
import type { DashboardSetupStep } from "@/types/schemas/dashboard";
import { getStepStatus, orderedSetupSteps } from "./dashboardSteps";
import { DashboardSetupAction } from "./DashboardSetupAction";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/client/components/ui/accordion";
import { Button } from "@/client/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";

// Hiding the checklist is a per-browser convenience, so it lives in
// localStorage; the steps themselves keep their server-side state.
function hiddenKey(projectId: string) {
  return `onboarding-checklist-hidden:${projectId}`;
}

export function readHidden(projectId: string) {
  try {
    return localStorage.getItem(hiddenKey(projectId)) === "1";
  } catch {
    return false;
  }
}

export function DashboardOnboarding({
  projectId,
  activation,
  onHide,
}: {
  projectId: string;
  activation: DashboardActivation;
  onHide?: () => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<DashboardSetupStep | null>(null);
  const [hidden, setHidden] = useState(() => readHidden(projectId));
  const dismiss = useMutation({
    mutationFn: ({
      step,
      dismissed,
    }: {
      step: DashboardSetupStep;
      dismissed: boolean;
    }) => setDashboardStepDismissed({ data: { projectId, step, dismissed } }),
    onSuccess: async (_, { step, dismissed }) => {
      await queryClient.invalidateQueries({
        queryKey: ["dashboardActivation", projectId],
      });
      setSelected(dismissed ? null : step);
      captureClientEvent("dashboard:setup_step_defer", { step, dismissed });
    },
  });
  const steps = orderedSetupSteps(activation, usesBetterAuthClient());
  const remaining = steps.filter(
    (step) => getStepStatus(activation, step.id) === "todo",
  );
  const completed = steps.filter(
    (step) => getStepStatus(activation, step.id) === "done",
  );
  const deferred = steps.filter(
    (step) => getStepStatus(activation, step.id) === "skipped",
  );

  if (hidden || (remaining.length === 0 && deferred.length === 0)) return null;

  return (
    <section
      aria-label="Onboarding checklist"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-5 sm:px-6">
        <div>
          <h2 className="text-lg font-semibold">Get started</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Set up the tools you want to use for this project.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Hide checklist"
          title="Hide checklist"
          className="-mr-2 -mt-1 shrink-0 text-muted-foreground"
          onClick={() => {
            try {
              localStorage.setItem(hiddenKey(projectId), "1");
            } catch {
              // Hidden for this visit only.
            }
            setHidden(true);
            onHide?.();
            captureClientEvent("dashboard:checklist_hide");
          }}
        >
          <X />
        </Button>
      </header>
      <Accordion
        value={selected ? [selected] : []}
        onValueChange={(value) => {
          const next = remaining.find((step) => step.id === value[0])?.id;
          setSelected(next ?? null);
          if (next)
            captureClientEvent("dashboard:next_move_click", { step: next });
        }}
      >
        {[false, true].map((more) => {
          const group = remaining.filter((item) => Boolean(item.more) === more);
          if (!group.length) return null;
          return (
            <div key={String(more)}>
              {more && (
                <h3 className="border-t px-5 py-3 text-sm font-medium text-muted-foreground sm:px-6">
                  More to try
                </h3>
              )}
              {group.map((item) => {
                const Icon = item.icon;
                return (
                  <AccordionItem key={item.id} value={item.id}>
                    <AccordionTrigger className="items-center gap-3 rounded-none border-0 px-5 py-4 hover:bg-foreground/5 hover:no-underline focus-visible:ring-inset aria-expanded:bg-primary/5 sm:px-6">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5">
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block">{item.label}</span>
                        <span className="mt-1 hidden text-xs font-normal text-muted-foreground sm:block">
                          {item.detail}
                        </span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-5 px-5 py-5 sm:px-6">
                      <DashboardSetupAction
                        step={item.id}
                        projectId={projectId}
                        domain={activation.domain}
                        onComplete={() => setSelected(null)}
                      />
                      <div className="border-t border-border pt-3">
                        <Button
                          variant="ghost"
                          className="text-muted-foreground"
                          disabled={dismiss.isPending}
                          onClick={() =>
                            dismiss.mutate({ step: item.id, dismissed: true })
                          }
                        >
                          {item.skipLabel}
                        </Button>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </div>
          );
        })}
      </Accordion>
      {deferred.length > 0 && (
        <Collapsible className="border-t border-border">
          <CollapsibleTrigger className="group flex w-full items-center gap-2 px-5 py-4 text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-6">
            <ChevronRight className="size-4 transition-transform group-data-panel-open:rotate-90" />
            {deferred.length} saved for later
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="space-y-1 px-5 pb-4 sm:px-6">
              {deferred.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-foreground/5 px-3 py-2"
                >
                  <span className="text-sm">{item.label}</span>
                  <Button
                    variant="ghost"
                    aria-label={`Restore ${item.label}`}
                    disabled={dismiss.isPending}
                    onClick={() =>
                      dismiss.mutate({ step: item.id, dismissed: false })
                    }
                  >
                    <RotateCcw data-icon="inline-start" /> Restore
                  </Button>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
      {completed.length > 0 && (
        <Collapsible className="border-t border-border">
          <CollapsibleTrigger className="group flex w-full items-center gap-2 px-5 py-4 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-6">
            <Check className="size-4 text-success" />
            {completed.length} completed
            <ChevronRight className="ml-auto size-4 text-muted-foreground transition-transform group-data-panel-open:rotate-90" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="space-y-3 px-5 pb-5 sm:px-6">
              {completed.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 text-sm text-muted-foreground"
                >
                  <Check className="size-4 shrink-0 text-success" />
                  {item.label}
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Target } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/client/components/ui/dialog";
import {
  ONBOARDING_GOALS,
  ONBOARDING_GOAL_LABELS,
  type OnboardingPreference,
} from "@/shared/onboarding";
import { setOnboardingGoal } from "@/serverFunctions/dashboard";
import type { DashboardActivation } from "@/server/features/dashboard/services/DashboardService";

const goalHelp =
  "Your goal changes which dashboard cards and setup steps come first.";

export function DashboardOnboardingGoal({
  projectId,
  goal,
}: {
  projectId: string;
  goal: OnboardingPreference;
}) {
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (nextGoal: OnboardingPreference) =>
      setOnboardingGoal({ data: { projectId, goal: nextGoal } }),
    onSuccess: ({ goal: savedGoal }) => {
      queryClient.setQueryData<DashboardActivation>(
        ["dashboardActivation", projectId],
        (current) =>
          current
            ? {
                ...current,
                onboarding: { ...current.onboarding, goal: savedGoal },
              }
            : current,
      );
      setEditing(false);
    },
  });
  const currentGoal = goal && goal !== "skipped" ? goal : null;
  const options = ONBOARDING_GOALS.map((option) => (
    <Button
      key={option}
      type="button"
      variant="outline"
      className={goal ? "justify-start whitespace-normal text-left" : undefined}
      aria-pressed={goal ? currentGoal === option : undefined}
      pending={save.isPending && save.variables === option}
      disabled={save.isPending}
      onClick={() => save.mutate(option)}
    >
      {ONBOARDING_GOAL_LABELS[option]}
      {currentGoal === option && <Check className="ml-auto" aria-hidden />}
    </Button>
  ));

  if (goal) {
    return (
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogTrigger
          render={
            <Button
              variant="outline"
              className={
                currentGoal ? undefined : "border-primary/60 bg-primary/10"
              }
            />
          }
        >
          <Target aria-hidden />
          {currentGoal
            ? `Goal · ${ONBOARDING_GOAL_LABELS[currentGoal]}`
            : "Set dashboard goal"}
          <ChevronDown aria-hidden />
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="pr-8">
            <DialogTitle>Choose a dashboard goal</DialogTitle>
            <DialogDescription>{goalHelp}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">{options}</div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <section
      aria-label="Choose a dashboard goal"
      className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/15 p-2">
          <Target className="size-5" aria-hidden />
        </div>
        <div>
          <h2 className="text-base font-semibold">Choose a dashboard goal</h2>
          <p className="text-sm text-muted-foreground">{goalHelp}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {options}
        <Button
          type="button"
          variant="ghost"
          pending={save.isPending && save.variables === "skipped"}
          disabled={save.isPending}
          onClick={() => save.mutate("skipped")}
        >
          Skip for now
        </Button>
      </div>
    </section>
  );
}

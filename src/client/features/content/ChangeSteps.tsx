import { Link } from "@tanstack/react-router";
import { Badge } from "@/client/components/ui/badge";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import {
  isStuckExecuting,
  needsReviewNote,
} from "@/server/features/content/rules/shopifyReconcileRules";
import { CheckWhatHappened } from "./CheckWhatHappened";
import {
  findChange,
  formatTime,
  type LedgerChange,
  type ShopifyActionName,
} from "./helpers";

type Tone = "success" | "warning" | "destructive" | "outline" | "info";
type Step = {
  key: string;
  label: string;
  badge: string;
  tone: Tone;
  lines: string[];
  url?: string | null;
  // Set when the change has been "executing" long enough that its Worker
  // probably died.
  stuck?: LedgerChange;
};

function proposedLine(c: LedgerChange) {
  return `Proposed ${formatTime(c.createdAt)}`;
}

function approvedLine(c: LedgerChange) {
  if (!c.approvedAt) return null;
  const by = c.approvedByName ? ` by ${c.approvedByName}` : "";
  return `Approved${by} ${formatTime(c.approvedAt)}`;
}

function executionStep(
  key: string,
  label: string,
  change: LedgerChange | null,
  ready: boolean,
): Step {
  if (!change) {
    return {
      key,
      label,
      badge: ready ? "Next" : "Waiting",
      tone: ready ? "info" : "outline",
      lines: [],
    };
  }
  const stuck = isStuckExecuting(change);
  const reviewNote = needsReviewNote(change);
  const lines = [
    proposedLine(change),
    approvedLine(change),
    change.executedAt ? `Executed ${formatTime(change.executedAt)}` : null,
    change.status === "failed" && change.error
      ? `Failed: ${change.error}`
      : null,
    change.rolledBackAt
      ? `Rolled back ${formatTime(change.rolledBackAt)}`
      : null,
    stuck
      ? (reviewNote ??
        "This has been running for several minutes. It may have stopped part way.")
      : null,
  ].filter((l): l is string => l !== null);
  const done = change.status === "executed";
  const rolled = change.status === "rolled_back";
  return {
    key,
    label,
    badge: done
      ? "Done"
      : rolled
        ? "Rolled back"
        : change.status === "failed"
          ? "Failed"
          : change.status === "executing"
            ? reviewNote
              ? "Needs review"
              : stuck
                ? "Stuck"
                : "Running"
            : change.status === "approved"
              ? "Approved, not run"
              : change.status === "proposed"
                ? "Needs approval"
                : change.status,
    tone: done
      ? "success"
      : change.status === "failed"
        ? "destructive"
        : rolled
          ? "outline"
          : "warning",
    lines,
    url: done ? change.targetUrl : null,
    stuck: stuck ? change : undefined,
  };
}

// The path an article takes: a new draft that is later published, or an update
// of an article already in the store. Each step reads the ledger entries for
// the current revision; nothing here is inferred from the editor.
export function ChangeSteps({
  projectId,
  changes,
  revision,
  path,
  blocked,
}: {
  projectId: string;
  changes: LedgerChange[];
  revision: number;
  path: "new" | "update";
  blocked: boolean;
}) {
  const latest = (action: ShopifyActionName) =>
    findChange(changes, action, revision) ??
    findChange(changes, action, revision, false);
  const main =
    path === "update" ? latest("update_existing") : latest("create_draft");
  const publish = path === "update" ? null : latest("publish_draft");
  const executed = changes.filter(
    (c) => c.contentRevision === revision && c.status === "executed",
  );
  const rolledBack = changes.filter(
    (c) => c.contentRevision === revision && c.status === "rolled_back",
  );
  const canRollBack = executed.some((c) => c.rollbackKind !== "none");

  const steps: Step[] = [
    {
      key: "draft",
      label: "Draft",
      badge: blocked ? "Blocked" : "Ready",
      tone: blocked ? "destructive" : "success",
      lines: [
        `Revision ${revision}`,
        blocked ? "A blocking quality check failed." : "Quality checks pass.",
      ],
    },
    {
      key: "proposed",
      label: "Proposed change",
      badge: main ? "Proposed" : "Not proposed",
      tone: main ? "success" : "info",
      lines: main ? [proposedLine(main)] : [],
    },
    {
      key: "approval",
      label: "Approval",
      badge: main?.approvedAt
        ? "Approved"
        : main
          ? "Needs approval"
          : "Waiting",
      tone: main?.approvedAt ? "success" : main ? "warning" : "outline",
      lines: main
        ? [approvedLine(main)].filter((l): l is string => l !== null)
        : [],
    },
    executionStep(
      "shopify",
      path === "update" ? "Update article" : "Shopify draft",
      main,
      false,
    ),
  ];
  if (path === "new") {
    steps.push(
      executionStep("publish", "Publish", publish, main?.status === "executed"),
    );
  }
  steps.push({
    key: "rollback",
    label: "Roll back",
    badge: canRollBack
      ? "Available"
      : rolledBack.length > 0
        ? "Rolled back"
        : "Not needed",
    tone: canRollBack ? "info" : "outline",
    lines: rolledBack.map((c) => `Rolled back ${formatTime(c.rolledBackAt)}`),
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Where this stands</h3>
        <Link
          to="/p/$projectId/changes"
          params={{ projectId }}
          className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Open the Change Ledger
        </Link>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step, index) => (
          <li
            key={step.key}
            className="space-y-1 rounded-lg border p-3 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {index + 1}. {step.label}
              </span>
              <Badge variant={step.tone}>{step.badge}</Badge>
            </div>
            {step.lines.map((line) => (
              <p key={line} className="break-words text-muted-foreground">
                {line}
              </p>
            ))}
            {step.stuck ? (
              <CheckWhatHappened projectId={projectId} change={step.stuck} />
            ) : null}
            {step.url ? (
              <SafeExternalLink
                url={step.url}
                label="Open in Shopify"
                className="inline-flex items-center gap-1 underline underline-offset-4"
              />
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

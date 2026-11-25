import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  decideClaimFact,
  saveClaimFactDraft,
  type getClaimOverview,
} from "@/serverFunctions/ai-claims";

type Data = Awaited<ReturnType<typeof getClaimOverview>>;
type Fact = Data["facts"][number];

export function ClaimFacts({
  projectId,
  data,
  refresh,
}: {
  projectId: string;
  data: Data;
  refresh: () => void;
}) {
  const [previous, setPrevious] = useState<Fact>();
  const [legacy, setLegacy] = useState<Data["legacy"][number]>();
  const [editing, setEditing] = useState(false);
  const draft = useMutation({
    mutationFn: (fields: FormData) => {
      const text = (key: string) => {
        const value = fields.get(key);
        return typeof value === "string" ? value.trim() : "";
      };
      return saveClaimFactDraft({
        data: {
          projectId,
          fact: {
            subject: text("subject"),
            predicate: text("predicate"),
            value: text("value"),
            polarity: text("polarity") === "denies" ? "denies" : "asserts",
            plan: text("plan") || null,
            market: text("market") || null,
            product: text("product") || null,
            version: text("version") || null,
            condition: text("condition") || null,
            effectiveFrom: text("effectiveFrom"),
            effectiveUntil: text("effectiveUntil") || null,
            sourceUrl: text("sourceUrl") || null,
            evidence: text("evidence"),
            previousId: previous?.id,
            legacyFactId: legacy?.id,
          },
        },
      });
    },
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const decide = useMutation({
    mutationFn: (input: { id: string; action: "approve" | "retire" }) =>
      decideClaimFact({ data: { projectId, ...input } }),
    onSuccess: refresh,
  });
  return (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Approved facts registry</h2>
          <p className="text-sm text-muted-foreground">
            Record the value, dates, and evidence a reviewer can verify.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setPrevious(undefined);
            setLegacy(undefined);
            setEditing(true);
          }}
        >
          New fact
        </Button>
      </div>
      {data.legacy.length > 0 && (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm">
            Import from Brand facts
          </summary>
          {data.legacy.map((fact) => (
            <div
              key={fact.id}
              className="flex items-center justify-between gap-2 border-t py-2 text-sm"
            >
              {fact.statement}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPrevious(undefined);
                  setLegacy(fact);
                  setEditing(true);
                }}
              >
                Create draft
              </Button>
            </div>
          ))}
        </details>
      )}
      {editing && (
        <form
          className="space-y-3 rounded-lg border p-3"
          key={previous?.id ?? legacy?.id ?? "new"}
          onSubmit={(event) => {
            event.preventDefault();
            draft.mutate(new FormData(event.currentTarget));
          }}
        >
          <h3 className="font-medium">
            {previous ? "Propose a replacement" : "Draft a fact"}
          </h3>
          {legacy && (
            <blockquote className="text-sm text-muted-foreground">
              {legacy.statement}
            </blockquote>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["subject", "Brand", 120, true],
                ["predicate", "Property", 120, true],
                ["value", "Value", 300, true],
                ["product", "Product", 120],
                ["plan", "Plan", 120],
                ["market", "Market", 120],
                ["version", "Product version", 120],
                ["condition", "Conditions", 120],
              ] as const
            ).map(([key, label, limit, required]) => (
              <label key={key} className="space-y-1 text-sm">
                <span>{label}</span>
                <Input
                  name={key}
                  defaultValue={previous?.[key] ?? ""}
                  maxLength={limit}
                  required={required}
                />
              </label>
            ))}
            <label className="space-y-1 text-sm">
              <span>Polarity</span>
              <select
                name="polarity"
                defaultValue={previous?.polarity ?? "asserts"}
                className="block h-9 w-full rounded-md border bg-background px-2"
              >
                <option value="asserts">Affirms</option>
                <option value="denies">Denies</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span>Effective from</span>
              <Input
                name="effectiveFrom"
                type="date"
                required
                defaultValue={previous?.effectiveFrom ?? ""}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>Expiry date</span>
              <Input
                name="effectiveUntil"
                type="date"
                defaultValue={previous?.effectiveUntil ?? ""}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>Official source URL</span>
              <Input
                name="sourceUrl"
                type="url"
                maxLength={1200}
                defaultValue={previous?.sourceUrl ?? ""}
              />
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span>Evidence excerpt or reviewer attestation</span>
            <textarea
              name="evidence"
              className="min-h-16 w-full rounded-md border bg-background p-2"
              required
              minLength={10}
              maxLength={500}
              defaultValue={previous?.evidence ?? ""}
            />
          </label>
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={draft.isPending}>
              Save draft
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
          {draft.error && (
            <p role="alert" className="text-sm text-destructive">
              {getStandardErrorMessage(draft.error)}
            </p>
          )}
        </form>
      )}
      {decide.error && (
        <p role="alert" className="text-sm text-destructive">
          {getStandardErrorMessage(decide.error)}
        </p>
      )}
      {data.facts.length === 0 && (
        <p className="text-sm text-muted-foreground">No fact versions yet.</p>
      )}
      {data.facts.map((fact) => (
        <details key={fact.id} className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer">
            <span className="font-medium">
              {fact.subject} · {fact.predicate} ·{" "}
              {fact.polarity === "denies" ? "Denies " : ""}
              {fact.value}
            </span>
            {" · "}
            {fact.state === "approved" &&
            fact.effectiveUntil &&
            fact.effectiveUntil <= new Date().toISOString().slice(0, 10)
              ? "expired"
              : fact.state}
          </summary>
          <p className="mt-2 text-muted-foreground">
            {fact.effectiveFrom} to {fact.effectiveUntil ?? "present"}
          </p>
          <p className="mt-2 whitespace-pre-wrap break-words">
            {fact.evidence}
          </p>
          {fact.sourceUrl && (
            <a
              className="mt-2 block break-all underline"
              href={fact.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Official source
            </a>
          )}
          {fact.reviewedAt && (
            <p className="mt-2 text-muted-foreground">
              Reviewed {fact.reviewedAt.slice(0, 10)}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {data.reviewer && fact.state === "draft" && (
              <Button
                size="sm"
                disabled={decide.isPending}
                onClick={() =>
                  decide.mutate({ id: fact.id, action: "approve" })
                }
              >
                Approve fact
              </Button>
            )}
            {data.reviewer &&
              (fact.state === "draft" || fact.state === "approved") && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={decide.isPending}
                  onClick={() =>
                    decide.mutate({ id: fact.id, action: "retire" })
                  }
                >
                  {fact.state === "draft" ? "Discard draft" : "Retire fact"}
                </Button>
              )}
            {fact.state === "approved" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPrevious(fact);
                  setLegacy(undefined);
                  setEditing(true);
                }}
              >
                Propose replacement
              </Button>
            )}
          </div>
        </details>
      ))}
    </section>
  );
}

import { captureClientEvent } from "@/client/lib/posthog";
import { DraftEvidence } from "./DraftEvidence";
import { sanitizeHtml } from "@/server/features/content/rules/sanitizeHtml";
import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { Button } from "@/client/components/ui/button";
import { aiMarketLabel } from "@/shared/ai-visibility";
import { likelyPageType } from "@/server/features/site-explorer/rules/pageType";
import type { DraftDetail } from "./helpers";

const TABS = ["Evidence", "Checks", "Changes"] as const;
const REPLACEMENTS = [
  ["in order to", "to"],
  ["due to the fact that", "because"],
  ["at this point in time", "now"],
] as const;

type Edit = {
  from: number;
  to: number;
  before: string;
  after: string;
  key: string;
};
type Snapshot = { html: string; suggestions: Edit[] };
type Applied = { edit: Edit; html: string };

function suggest(editor: Editor): Edit[] {
  const suggestions: Edit[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text || suggestions.length >= 8) return;
    for (const [before, after] of REPLACEMENTS) {
      const expression = new RegExp(`\\b${before}\\b`, "gi");
      for (const match of node.text.matchAll(expression)) {
        const from = pos + match.index;
        const key = `${from}:${match[0]}`;
        const next =
          match[0][0] === match[0][0]?.toUpperCase()
            ? after[0]?.toUpperCase() + after.slice(1)
            : after;
        if (suggestions.length < 8)
          suggestions.push({
            from,
            to: from + match[0].length,
            before: match[0],
            after: next,
            key,
          });
      }
    }
  });
  return suggestions;
}

function cover(text: string, terms: string) {
  const words = [
    ...new Set(terms.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []),
  ];
  const found = new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  return words.length
    ? words.filter((term) => found.has(term)).length / words.length
    : null;
}

export function DraftReview({
  detail,
  editor,
  html,
  dirty,
  editable,
}: {
  detail: DraftDetail;
  editor: Editor | null;
  html: string;
  dirty: boolean;
  editable: boolean;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Evidence");
  const [excluded, setExcluded] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const { asset, opportunity, evidence, market, domain, checks } = detail;
  const target = asset.importedFrom ?? opportunity?.pageUrl;
  const query = opportunity?.query ?? asset.searchIntent;
  const searches = evidence.filter((item) => item.label === "Reported search");
  const bodyText = editor?.state.doc.textContent ?? "";
  const opening = editor?.state.doc.firstChild?.textContent ?? "";
  const openingCoverage = cover(opening, query);
  const linked = editor
    ? [...html.matchAll(/href="([^"]+)"/g)].some((match) => {
        if (match[1].startsWith("/") && !match[1].startsWith("//")) return true;
        try {
          const host = new URL(match[1]).hostname.replace(/^www\./, "");
          return host === domain?.replace(/^www\./, "");
        } catch {
          return false;
        }
      })
    : false;
  const suggested =
    snapshot?.suggestions.filter((item) => !dismissed.includes(item.key)) ?? [];
  const stale = snapshot?.html !== html;
  return (
    <aside className="min-w-0 self-start rounded-xl border border-border bg-card">
      <div className="space-y-1 border-b border-border p-4">
        {query ? (
          <p className="break-words text-sm font-semibold">{query}</p>
        ) : (
          <p className="text-sm font-semibold">Draft review</p>
        )}
        <p className="text-xs text-muted-foreground">
          {[
            target ? likelyPageType(target)?.replaceAll("_", " ") : null,
            market ? aiMarketLabel(market) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {target && /^https?:\/\//i.test(target) ? (
          <a
            href={target}
            className="block truncate text-xs underline"
            target="_blank"
            rel="noreferrer"
          >
            {target}
          </a>
        ) : null}
      </div>
      <div
        className="flex flex-wrap gap-1 border-b border-border p-2"
        role="group"
        aria-label="Review panel"
      >
        {TABS.map((name) => (
          <Button
            key={name}
            variant={tab === name ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={tab === name}
            onClick={() => setTab(name)}
          >
            {name}
          </Button>
        ))}
      </div>
      <div className="space-y-3 p-4 text-sm">
        {tab === "Evidence" ? (
          <DraftEvidence
            detail={detail}
            excluded={excluded}
            setExcluded={setExcluded}
          />
        ) : null}
        {tab === "Checks" ? (
          <>
            {openingCoverage !== null ? (
              <Check
                name="Primary question in the opening"
                passed={openingCoverage >= 0.5}
                detail="Checks wording overlap. Confirm the opening actually answers the question."
              />
            ) : null}
            {searches.length ? (
              <Check
                name="Related searches covered"
                passed={searches.some(
                  (item) => (cover(bodyText, item.value) ?? 0) >= 0.75,
                )}
                detail="Uses the wording of saved fan-out searches. Review which topics fit the page."
              />
            ) : null}
            <Check
              name="Link to a related page on your site"
              passed={linked}
              detail="Check that the link helps the reader continue."
            />
            <p className="border-t pt-3 text-xs font-semibold">
              {checks.filter((check) => check.passed).length} of {checks.length}{" "}
              saved checks passed{dirty ? " · Save to rerun" : ""}
            </p>
            {checks
              .filter((check) => !check.passed)
              .map((check) => (
                <Check
                  key={check.key}
                  name={check.key.replaceAll("_", " ")}
                  passed={false}
                  detail={check.detail}
                />
              ))}
          </>
        ) : null}
        {tab === "Changes" ? (
          <>
            <p className="text-xs text-muted-foreground">
              Review wording edits one at a time. This uses the current draft
              and costs no credits.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={!editor || !editable}
              onClick={() => {
                if (!editor) return;
                if (snapshot && stale)
                  captureClientEvent("content_studio:suggestion_reviewed", {
                    assetId: asset.id,
                    revision: asset.revision,
                    outcome: "stale",
                  });
                setDismissed([]);
                setSnapshot({ html, suggestions: suggest(editor) });
              }}
            >
              {snapshot ? "Review draft again" : "Find wording edits"}
            </Button>
            {snapshot && !suggested.length ? (
              <p className="text-xs text-muted-foreground">
                No wording edits to review.
              </p>
            ) : null}
            {applied ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={applied.html !== html}
                onClick={() => {
                  if (!editor || applied.html !== html) return;
                  const { edit } = applied;
                  editor
                    .chain()
                    .focus()
                    .setTextSelection({
                      from: edit.from,
                      to: edit.from + edit.after.length,
                    })
                    .insertContent(edit.before)
                    .run();
                  setApplied(null);
                }}
              >
                Undo accepted edit
              </Button>
            ) : null}
            {suggested.map((edit) => (
              <div key={edit.key} className="space-y-1.5 rounded-lg border p-3">
                <p className="text-xs font-medium">
                  {stale
                    ? "Draft changed · review again"
                    : "Shorten the phrase"}
                </p>
                <p className="text-xs">
                  <del>{edit.before}</del>
                </p>
                <p className="text-xs">
                  <ins>{edit.after}</ins>
                </p>
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={stale}
                    onClick={() =>
                      editor
                        ?.chain()
                        .focus()
                        .setTextSelection({ from: edit.from, to: edit.to })
                        .scrollIntoView()
                        .run()
                    }
                  >
                    Show passage
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={stale || !editable}
                    onClick={() => {
                      if (
                        !editor ||
                        stale ||
                        editor.state.doc.textBetween(edit.from, edit.to) !==
                          edit.before
                      )
                        return;
                      editor
                        .chain()
                        .focus()
                        .setTextSelection({ from: edit.from, to: edit.to })
                        .insertContent(edit.after)
                        .run();
                      setApplied({
                        edit,
                        html: sanitizeHtml(editor.getHTML()),
                      });
                      setDismissed([...dismissed, edit.key]);
                      captureClientEvent("content_studio:suggestion_reviewed", {
                        assetId: asset.id,
                        revision: asset.revision,
                        outcome: "accepted",
                      });
                    }}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDismissed([...dismissed, edit.key]);
                      captureClientEvent("content_studio:suggestion_reviewed", {
                        assetId: asset.id,
                        revision: asset.revision,
                        outcome: "dismissed",
                      });
                    }}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </aside>
  );
}

function Check({
  name,
  passed,
  detail,
}: {
  name: string;
  passed: boolean;
  detail: string;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-sm font-medium">
        <span className={passed ? "text-success" : "text-warning-foreground"}>
          {passed ? "✓" : "○"}
        </span>{" "}
        {name}
      </p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

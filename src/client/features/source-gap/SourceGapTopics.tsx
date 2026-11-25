import { useQuery } from "@tanstack/react-query";
import { ROOT_CAUSE_LABELS } from "@/shared/source-gap";
import { sourceGapTopicsQueryOptions } from "./sourceGapShared";

/** Recurring source gaps by prompt group, each pattern with the prompts behind it. */
export function SourceGapTopics({ projectId }: { projectId: string }) {
  const query = useQuery(sourceGapTopicsQueryOptions(projectId));
  const topics = (query.data ?? []).filter((t) => t.analyzed > 0);
  if (topics.length === 0) return null;
  return (
    <section className="space-y-3" aria-label="Source gaps by prompt group">
      <h2 className="text-sm font-medium">Source gaps by prompt group</h2>
      <ul className="space-y-3">
        {topics.map((t) => (
          <li key={t.topic} className="space-y-2 rounded-xl border bg-card p-4">
            <div>
              <h3 className="text-sm font-medium">{t.topic}</h3>
              <p className="text-xs text-muted-foreground">
                {t.analyzed} of {t.prompts} prompts analyzed · {t.answers}{" "}
                answers · {t.competitorMentionsWithoutYou} name a competitor
                without you · {t.competitorOwnedCitations} citations of
                competitor-owned pages
              </p>
            </div>
            <ul className="space-y-1.5 text-sm">
              {t.patterns.map((p) => (
                <li key={p.category}>
                  <span className="font-medium">
                    {ROOT_CAUSE_LABELS[p.category]}
                  </span>{" "}
                  <span className="text-xs text-muted-foreground">
                    in {p.prompts.length} of {t.analyzed}:{" "}
                    {p.prompts.map((x) => x.prompt).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Prompts with different intents are analyzed on their own; read
              each before acting on a shared pattern.
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

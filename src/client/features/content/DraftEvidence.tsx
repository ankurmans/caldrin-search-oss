import { Button } from "@/client/components/ui/button";
import type { DraftDetail } from "./helpers";

export function DraftEvidence({
  detail,
  excluded,
  setExcluded,
}: {
  detail: DraftDetail;
  excluded: string[];
  setExcluded: (items: string[]) => void;
}) {
  const { benchmarks, asset, evidence, opportunity } = detail;
  const query = opportunity?.query ?? asset.searchIntent;
  return (
    <>
      {benchmarks.length ? (
        <section className="space-y-2 border-b border-border pb-3">
          <h3 className="font-medium">
            Same page type in stored Google results
          </h3>
          {benchmarks
            .filter((item) => !excluded.includes(item.url))
            .map((item) => (
              <div key={item.url} className="space-y-0.5">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-words underline"
                >
                  #{item.rank} {item.title}
                </a>
                <p className="text-xs text-muted-foreground">
                  {item.fetchedAt?.slice(0, 10) ?? "Read date unavailable"} ·
                  Review intent fit
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setExcluded([...excluded, item.url])}
                >
                  Exclude benchmark
                </Button>
              </div>
            ))}
        </section>
      ) : query ? (
        <p className="text-xs text-muted-foreground">
          No matching Google results are stored for this query, market and page
          type.
        </p>
      ) : null}
      {asset.briefMarkdown ? (
        <details>
          <summary className="cursor-pointer font-medium">
            Editorial brief
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-xs">
            {asset.briefMarkdown}
          </p>
        </details>
      ) : null}
      {!evidence.length ? (
        <p className="text-muted-foreground">
          Start from a search opportunity to attach its evidence.
        </p>
      ) : null}
      {evidence
        .filter((item) => !excluded.includes(item.id))
        .map((item) => (
          <div
            key={item.id}
            className="space-y-0.5 border-b border-border pb-2 last:border-b-0"
          >
            <p className="text-xs text-muted-foreground">
              {item.label}
              {item.observedAt ? ` · ${item.observedAt.slice(0, 10)}` : ""}
            </p>
            <p className="break-words">
              {item.url && /^(https?:\/\/|\/p\/)/i.test(item.url) ? (
                <a href={item.url} className="underline underline-offset-2">
                  {item.value}
                </a>
              ) : (
                item.value
              )}
            </p>
            {item.url && /^https?:\/\//i.test(item.url) ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setExcluded([...excluded, item.id])}
              >
                Hide from review
              </Button>
            ) : null}
          </div>
        ))}
      {excluded.length ? (
        <Button size="sm" variant="ghost" onClick={() => setExcluded([])}>
          Restore {excluded.length} hidden items
        </Button>
      ) : null}
    </>
  );
}

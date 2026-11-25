import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/client/components/ui/accordion";
import { Badge } from "@/client/components/ui/badge";
import { aiBrandLabel, type AiAnswer } from "@/shared/ai-visibility";
import { DomainFavicon } from "./DomainFavicon";
import { brandHighlightClasses } from "./answerSegments";

/** Cited pages in the engine's order, numbered as the highlights refer to them. */
export function AnswerSources({ answer }: { answer: AiAnswer }) {
  if (!answer.sources.length)
    return (
      <p className="text-sm text-muted-foreground">
        This answer has no citations.
      </p>
    );
  const named = new Set(answer.citedTextSpans.flatMap((s) => s.positions));
  return (
    <ol className="space-y-3">
      {answer.sources.map((source) => (
        <li
          key={source.url}
          className="space-y-2 rounded-lg border bg-card p-3 border-border"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono text-foreground">
              [{source.position}]
            </span>
            <DomainFavicon domain={source.domain} />
            <span className="truncate">{source.domain}</span>
            {named.has(source.position) && (
              <Badge variant="info" size="sm">
                Named in answer
              </Badge>
            )}
          </div>
          <SafeExternalLink
            url={source.url}
            label={source.title || source.url}
            className="flex items-start gap-1 break-words text-sm font-medium hover:text-brand-text hover:underline"
          />
        </li>
      ))}
    </ol>
  );
}

function Flag({ on, label, off }: { on: boolean; label: string; off: string }) {
  return (
    <Badge variant={on ? "success" : "secondary"}>{on ? label : off}</Badge>
  );
}

function VerdictBadge({ value }: { value: boolean | null }) {
  if (value === null)
    return (
      <Badge
        variant="secondary"
        title="No explicit recommendation wording was found. This is a phrase check, not a judgment."
      >
        No verdict
      </Badge>
    );
  return value ? (
    <Badge variant="success">Recommended</Badge>
  ) : (
    <Badge variant="destructive">Recommended against</Badge>
  );
}

/** Each tracked brand: whether it is named, cited, recommended, and where. */
export function AnswerEntities({ answer }: { answer: AiAnswer }) {
  const { brands } = answer.observation;
  const answered = answer.observation.answerStatus === "answered";
  const classes = brandHighlightClasses(answer);
  if (!brands.length)
    return (
      <p className="text-sm text-muted-foreground">
        No brand evidence was captured.
      </p>
    );
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Mentions appear in the answer text. Citations link to the brand’s
        domain.
      </p>
      {brands.map((brand) => {
        const mention = answer.mentions.find((m) => m.domain === brand.domain);
        const spans = mention?.spans ?? [];
        return (
          <div
            key={brand.domain}
            className="space-y-2 rounded-lg border bg-card p-3 border-border"
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <span
                aria-hidden="true"
                className={`size-3 shrink-0 rounded-sm ${classes.get(brand.domain) ?? ""}`}
              />
              <DomainFavicon domain={brand.domain} />
              {aiBrandLabel(brand)}
              {brand.own && (
                <Badge variant="secondary" size="sm">
                  You
                </Badge>
              )}
            </div>
            {answered && (
              <div className="flex flex-wrap gap-1.5">
                <Flag
                  on={brand.mentioned}
                  label="Mentioned"
                  off="Not mentioned"
                />
                <Flag on={brand.cited} label="Cited" off="Not cited" />
                {brand.mentioned && (
                  <VerdictBadge value={mention?.recommended ?? null} />
                )}
              </div>
            )}
            {answered && brand.mentioned && (
              <p className="text-xs text-muted-foreground">
                {spans.length} {spans.length === 1 ? "mention" : "mentions"} in
                this text · Sentiment:{" "}
                {mention?.sentiment?.label ?? "not measured yet"}
              </p>
            )}
            {spans.length > 0 && answer.answerText && (
              <Accordion>
                <AccordionItem value="mentions">
                  <AccordionTrigger className="py-1 text-xs">
                    Mention excerpts ({spans.length})
                  </AccordionTrigger>
                  <AccordionContent
                    className="space-y-2 pt-2 text-xs text-muted-foreground"
                    data-ph-mask
                  >
                    {spans.map((span, index) => (
                      <p key={`${span.start}-${span.end}-${index}`}>
                        “
                        {answer.answerText!.slice(
                          Math.max(0, span.start - 70),
                          span.start,
                        )}
                        <mark className="bg-primary/15 text-foreground">
                          {answer.answerText!.slice(span.start, span.end)}
                        </mark>
                        {answer.answerText!.slice(span.end, span.end + 70)}”
                      </p>
                    ))}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
          </div>
        );
      })}
    </div>
  );
}

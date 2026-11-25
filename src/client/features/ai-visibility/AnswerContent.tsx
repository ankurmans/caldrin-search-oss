import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Highlighter } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MARKDOWN_COMPONENTS } from "@/client/components/Markdown";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { Button } from "@/client/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/client/components/ui/tabs";
import {
  aiObservationStatusLabel,
  type AiAnswer,
} from "@/shared/ai-visibility";
import { AnswerEntities, AnswerSources } from "./AnswerEvidenceLists";
import {
  AnswerAmbiguities,
  AnswerFacts,
  HighlightedAnswerText,
} from "./HighlightedAnswer";
import { FanOutLink } from "../source-intelligence/FanOutLink";
import { aiAnswerQueryOptions } from "./HighlightedAnswerLoader";
import { AiLoading, AiQueryError } from "./shared";

/** The selected engine's answer lives in the prompt page, beside its sources. */
export function AnswerContent({
  projectId,
  observationId,
}: {
  projectId: string;
  observationId: string;
}) {
  const query = useQuery(aiAnswerQueryOptions(projectId, observationId));
  if (query.isPending) return <AiLoading />;
  if (query.isError)
    return (
      <AiQueryError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  return (
    <AnswerEvidence
      answer={query.data}
      projectId={projectId}
      observationId={observationId}
    />
  );
}

function AnswerEvidence({
  answer,
  projectId,
  observationId,
}: {
  answer: AiAnswer;
  projectId: string;
  observationId: string;
}) {
  const [view, setView] = useState("answer");
  const [format, setFormat] = useState<"highlighted" | "formatted">(
    "highlighted",
  );
  const citations = answer.sources;
  return (
    <div>
      {answer.observation.answerStatus === "no_answer" && (
        <p className="border-b px-5 py-3 text-sm text-warning border-border">
          {answer.observation.engine === "google_ai_overview"
            ? "Google showed no AI Overview for this search."
            : "No substantive answer was returned."}{" "}
          This collection is excluded from visibility rates.
        </p>
      )}
      {answer.observation.error && (
        <p
          role="alert"
          className="border-b bg-destructive/5 px-5 py-3 text-sm text-destructive border-border"
        >
          {getStandardErrorMessage(new Error(answer.observation.error))}
        </p>
      )}
      {answer.truncated && (
        <p className="border-b px-5 py-3 text-xs text-warning border-border">
          This response was truncated. The retained evidence may be incomplete.
        </p>
      )}
      <div
        className="flex gap-2 border-b px-5 py-3 lg:hidden border-border"
        role="group"
        aria-label="Answer view"
      >
        <Button
          size="sm"
          variant={view === "answer" ? "secondary" : "outline"}
          aria-pressed={view === "answer"}
          onClick={() => setView("answer")}
        >
          Answer
        </Button>
        <Button
          size="sm"
          variant={view === "citations" ? "secondary" : "outline"}
          aria-pressed={view === "citations"}
          onClick={() => setView("citations")}
        >
          Citations ({citations.length})
        </Button>
        <Button
          size="sm"
          variant={view === "brands" ? "secondary" : "outline"}
          aria-pressed={view === "brands"}
          onClick={() => setView("brands")}
        >
          Brands
        </Button>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
        <article
          className={`min-w-0 space-y-5 p-5 text-sm sm:p-6 lg:block ${view !== "answer" ? "hidden" : ""}`}
          aria-label="AI answer"
          data-ph-mask
        >
          <AnswerFacts answer={answer} />
          <FanOutLink projectId={projectId} answer={observationId} />
          {answer.answerText ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">Answer</h3>
                <SegmentedToggle
                  showLabels
                  value={format}
                  onChange={setFormat}
                  items={[
                    {
                      value: "highlighted",
                      label: "Highlighted",
                      icon: <Highlighter aria-hidden="true" />,
                    },
                    {
                      value: "formatted",
                      label: "Formatted",
                      icon: <FileText aria-hidden="true" />,
                    },
                  ]}
                />
              </div>
              {format === "highlighted" || !answer.answerMarkdown ? (
                <>
                  <HighlightedAnswerText answer={answer} />
                  <AnswerAmbiguities answer={answer} />
                </>
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={ANSWER_COMPONENTS}
                >
                  {answer.answerMarkdown}
                </ReactMarkdown>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">
              No answer was captured. Status:{" "}
              {aiObservationStatusLabel(answer.observation.status)}. This is not
              a negative brand result.
            </p>
          )}
        </article>
        <aside
          className={`min-w-0 bg-muted/20 p-4 lg:block lg:border-l border-border ${view === "answer" ? "hidden" : ""}`}
          aria-label="Answer evidence"
        >
          <Tabs
            value={view === "brands" ? "brands" : "citations"}
            onValueChange={(value: unknown) => {
              if (value === "brands" || value === "citations") setView(value);
            }}
            className="gap-4"
          >
            <TabsList className="hidden w-full lg:flex">
              <TabsTrigger value="citations">
                Citations ({citations.length})
              </TabsTrigger>
              <TabsTrigger value="brands">Brands</TabsTrigger>
            </TabsList>
            <TabsContent value="citations" className="space-y-3">
              <AnswerSources answer={answer} />
            </TabsContent>
            <TabsContent value="brands" className="space-y-3">
              <AnswerEntities answer={answer} />
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}

const ANSWER_COMPONENTS = {
  ...MARKDOWN_COMPONENTS,
  img: ({ alt }: { alt?: string }) => (
    <span className="text-muted-foreground">
      {alt ? `[Image: ${alt}]` : "[Image]"}
    </span>
  ),
};

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { TablePagination } from "@/client/components/table/TablePagination";
import { aiMarketLabel } from "@/shared/ai-visibility";
import {
  SOURCE_PAGE_SIZES,
  engineLabel,
  type SourceFilters,
} from "@/types/schemas/source-intelligence";
import {
  getFanOutPrompts,
  getFanOutAnswers,
  getSourceIntelligence,
} from "@/serverFunctions/source-intelligence";

import { captureLabel, FanOutAnswer } from "./FanOutAnswer";

export function FanOutPrompts({
  projectId,
  filters,
  linkedAnswer,
  toolbar,
}: {
  projectId: string;
  filters: SourceFilters;
  linkedAnswer?: string;
  toolbar: ReactNode;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] =
    useState<(typeof SOURCE_PAGE_SIZES)[number]>(25);
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["fan-out-prompts", projectId, filters, page, pageSize],
    queryFn: () =>
      getFanOutPrompts({ data: { projectId, filters, page, pageSize } }),
  });
  return (
    <section className="divide-y divide-border rounded-xl border bg-card">
      <div className="p-3">{toolbar}</div>
      {linkedAnswer ? (
        <div className="p-4">
          <FanOutAnswer projectId={projectId} observationId={linkedAnswer} />
        </div>
      ) : null}
      {list.isPending ? (
        <p className="p-4 text-sm" role="status">
          Loading tracked prompts…
        </p>
      ) : null}
      {list.isError ? (
        <QueryError
          error={list.error}
          fallback="Could not load tracked prompts."
          onRetry={() => void list.refetch()}
        />
      ) : null}
      {list.data?.rows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          No completed answers match these filters.
        </p>
      ) : null}
      {list.data?.rows.map((row) => {
        const key = `${row.promptId}:${row.locationCode}:${row.languageCode}`;
        return (
          <div key={key} className="px-4 py-3">
            <button
              className="flex w-full flex-wrap items-center justify-between gap-2 text-left text-sm"
              type="button"
              aria-expanded={open === key}
              onClick={() => setOpen(open === key ? null : key)}
            >
              <span className="min-w-0 break-words">
                <span className="block font-medium">{row.prompt}</span>
                <span className="text-xs text-muted-foreground">
                  {aiMarketLabel(row)} ·{" "}
                  {row.lastSeen?.slice(0, 10) ?? "Date unavailable"}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {row.reported} of {row.total} answers with reported searches{" "}
                {open === key ? "−" : "+"}
              </span>
            </button>
            {open === key ? (
              <PromptAnswers
                projectId={projectId}
                filters={{
                  ...filters,
                  promptId: row.promptId,
                  locationCode: row.locationCode,
                  languageCode: row.languageCode,
                }}
                total={Number(row.total)}
                reported={Number(row.reported)}
              />
            ) : null}
          </div>
        );
      })}
      <TablePagination
        page={page}
        pageSize={pageSize}
        pageSizes={SOURCE_PAGE_SIZES}
        totalCount={list.data?.total ?? null}
        isLoading={list.isPending}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          const next = SOURCE_PAGE_SIZES.find((value) => value === size);
          if (next) setPageSize(next);
          setPage(1);
        }}
      />
    </section>
  );
}

function PromptAnswers({
  projectId,
  filters,
  total,
  reported,
}: {
  projectId: string;
  filters: SourceFilters;
  total: number;
  reported: number;
}) {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const terms = useQuery({
    queryKey: ["fan-out-query-summary", projectId, filters],
    queryFn: () =>
      getSourceIntelligence({
        data: {
          projectId,
          filters,
          view: "queries",
          pageSize: 25,
          sortBy: "answers",
        },
      }),
    enabled: reported > 0,
  });
  const answers = useQuery({
    queryKey: ["fan-out-answers", projectId, filters, page],
    queryFn: () => getFanOutAnswers({ data: { projectId, filters, page } }),
  });
  if (answers.isPending)
    return (
      <p role="status" className="py-3 text-sm">
        Loading answers…
      </p>
    );
  if (answers.isError)
    return (
      <QueryError
        error={answers.error}
        fallback="Could not load answers."
        onRetry={() => void answers.refetch()}
      />
    );
  return (
    <div className="mt-3 divide-y divide-border rounded-lg border">
      {terms.data?.queryRows.length ? (
        <details className="px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium">
            Searches across these answers
          </summary>
          <ul className="mt-2 space-y-1">
            {terms.data.queryRows.map((term) => (
              <li key={term.query}>
                <span className="font-medium">{term.query}</span>{" "}
                <span className="text-muted-foreground">
                  · seen in {term.answers} of {reported} answers with reported
                  searches
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {answers.data.map((answer) => (
        <div key={answer.id} className="p-3">
          <button
            type="button"
            className="flex w-full flex-wrap justify-between gap-x-3 text-left text-xs"
            aria-expanded={open === answer.id}
            onClick={() => setOpen(open === answer.id ? null : answer.id)}
          >
            <span className="font-medium">
              {engineLabel(answer.engine)} ·{" "}
              {answer.collectedAt?.slice(0, 10) ?? "Date unavailable"}
              {answer.promptVersion
                ? ` · Prompt set v${answer.promptVersion}`
                : ""}
            </span>
            <span className="text-muted-foreground">
              {captureLabel(
                Number(answer.queryReported),
                answer.queriesExposed,
                "searches",
              )}
            </span>
          </button>
          {open === answer.id ? (
            <FanOutAnswer projectId={projectId} observationId={answer.id} />
          ) : null}
        </div>
      ))}
      {total > 20 ? (
        <TablePagination
          page={page}
          pageSize={20}
          totalCount={total}
          onPageChange={setPage}
        />
      ) : null}
    </div>
  );
}

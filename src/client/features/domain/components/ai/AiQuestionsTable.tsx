import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { HelpLabel } from "@/client/components/HelpLabel";
import { TablePagination } from "@/client/components/table/TablePagination";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Input } from "@/client/components/ui/input";
import type { Stored } from "@/client/features/domain/components/ai/AiMentionsView";
import { formatNumber } from "@/client/features/domain/utils";

export const PLATFORM_LABELS = {
  chat_gpt: "ChatGPT",
  google: "Google AI Overviews",
} as const;
type Platform = keyof typeof PLATFORM_LABELS;

const PAGE_SIZES = [10, 25, 50, 100] as const;

function formatDay(iso: string | null) {
  return iso ? iso.slice(0, 10) : "-";
}

export function Questions({ data }: { data: Stored }) {
  const [platform, setPlatform] = useState<Platform | "all">("all");
  const [text, setText] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(10);

  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return data.topQueries.filter(
      (row) =>
        (platform === "all" || row.platform === platform) &&
        (needle === "" || row.question.toLowerCase().includes(needle)),
    );
  }, [data.topQueries, platform, text]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages);
  const visible = rows.slice((current - 1) * pageSize, current * pageSize);

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-base font-semibold">
          <HelpLabel
            label="Questions that mention the domain"
            helpText="The prompts or keywords behind the answers the provider holds. For Google AI Overviews the question is the search that triggered the overview. ChatGPT data is US English only. A mention means the answer names the domain; a citation means it links a page from it. The provider does not report recommendations."
          />
        </h2>
        {(["all", "chat_gpt", "google"] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={platform === value ? "secondary" : "outline"}
            aria-pressed={platform === value}
            onClick={() => {
              setPlatform(value);
              setPage(1);
            }}
          >
            {value === "all" ? "All engines" : PLATFORM_LABELS[value]}
          </Button>
        ))}
        <Input
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setPage(1);
          }}
          placeholder="Filter questions"
          aria-label="Filter questions"
          className="h-8 w-full sm:w-52"
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No questions match this filter.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 text-left font-normal">Question</th>
                <th className="py-1 pl-3 text-left font-normal">Engine</th>
                <th className="py-1 pl-3 text-right font-normal">AI volume</th>
                <th className="py-1 pl-3 text-left font-normal">Cited here</th>
                <th className="py-1 pl-3 text-left font-normal">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const own = row.citedSources.filter(
                  (s) =>
                    s.domain === data.domain ||
                    (s.domain ?? "").endsWith(`.${data.domain}`),
                );
                return (
                  <tr
                    key={`${row.platform}:${row.question}`}
                    className="border-t border-border align-top"
                  >
                    <td className="py-1.5 pr-2 break-words">{row.question}</td>
                    <td className="py-1.5 pl-3 whitespace-nowrap">
                      {PLATFORM_LABELS[row.platform]}
                    </td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">
                      {formatNumber(row.aiSearchVolume)}
                    </td>
                    <td className="py-1.5 pl-3">
                      {own.length > 0 ? (
                        <span className="break-all">
                          {own.map((s) => (
                            <a
                              key={s.url}
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              className="mr-2 inline-flex items-center gap-1 underline"
                            >
                              {new URL(s.url).pathname}
                              <ExternalLink className="size-3" />
                            </a>
                          ))}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {row.citedSources.length > 0
                            ? "Another domain"
                            : "No citation"}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pl-3 whitespace-nowrap text-muted-foreground">
                      {formatDay(row.lastSeenAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 ? (
        <TablePagination
          page={page}
          pageSize={pageSize}
          pageSizes={PAGE_SIZES}
          totalCount={rows.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      ) : null}
    </Card>
  );
}

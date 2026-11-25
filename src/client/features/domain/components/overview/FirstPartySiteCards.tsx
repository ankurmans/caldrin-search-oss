import { Link } from "@tanstack/react-router";
import {
  getDomainAiVisibility,
  getDomainAuditHealth,
} from "@/serverFunctions/domain";
import {
  Frame,
  Message,
  SourceCard,
  Stat,
  pointsChange,
  useFirstParty,
  type Input,
} from "@/client/features/domain/components/overview/FirstPartyShared";
import { SourceNote } from "@/client/features/domain/components/overview/SourceNote";
import { formatNumber, formatRounded } from "@/client/features/domain/utils";

export function AuditCard({ input }: { input: Input }) {
  const query = useFirstParty("audit", input, (data) =>
    getDomainAuditHealth({ data }),
  );
  const { projectId } = input;
  return (
    <SourceCard
      query={query}
      title="Site Audit"
      projectId={projectId}
      connectLabel="Site Audit"
    >
      {(data) => {
        if (data.status === "no_audit") {
          return (
            <Frame title="Site Audit" note={null}>
              <Message>
                No completed audit yet.{" "}
                <Link
                  to="/p/$projectId/audit"
                  params={{ projectId }}
                  className="text-foreground underline"
                >
                  Run a Site Audit
                </Link>{" "}
                to see page health here.
              </Message>
            </Frame>
          );
        }
        if (data.status !== "ok") return null;
        const rows = [
          ["2xx OK", data.statusCounts.ok],
          ["3xx redirect", data.statusCounts.redirect],
          ["4xx client error", data.statusCounts.clientError],
          ["5xx server error", data.statusCounts.serverError],
          ["No status", data.statusCounts.noStatus],
        ] as const;
        return (
          <Frame
            title="Site Audit, latest crawl"
            note={
              <SourceNote
                source="Site Audit observations"
                date={data.completedAt}
              />
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <Stat
                label="Pages crawled"
                value={formatNumber(data.pageCount)}
              />
              <Stat
                label="Issues found"
                value={formatNumber(data.issueCount)}
              />
            </div>
            <table className="w-full text-sm">
              <tbody>
                {rows.map(([label, count]) => (
                  <tr key={label} className="border-t border-border">
                    <td className="py-1.5">{label}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatNumber(count)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Link
              to="/p/$projectId/audit"
              params={{ projectId }}
              className="text-sm text-foreground underline"
            >
              Open the audit
            </Link>
          </Frame>
        );
      }}
    </SourceCard>
  );
}

// The trend's rates are already 0 to 100, unlike Search Console's fractions.
const whole = (rate: number | null) =>
  rate == null ? "-" : `${formatRounded(rate)}%`;

export function AiVisibilityCard({ input }: { input: Input }) {
  const query = useFirstParty("ai-visibility", input, (data) =>
    getDomainAiVisibility({ data }),
  );
  const { projectId } = input;
  return (
    <SourceCard
      query={query}
      title="AI answers"
      projectId={projectId}
      connectLabel="AI visibility"
    >
      {(data) => {
        if (data.status === "no_runs") {
          return (
            <Frame title="AI answers, tracked prompts" note={null}>
              <Message>
                No tracked-prompt runs in the last 28 days.{" "}
                <Link
                  to="/p/$projectId/ai-visibility"
                  params={{ projectId }}
                  className="text-foreground underline"
                >
                  Open AI Search
                </Link>
              </Message>
            </Frame>
          );
        }
        if (data.status !== "ok") return null;
        return (
          <Frame
            title="AI answers, tracked prompts"
            note={
              <SourceNote
                source={`Your tracked prompts, last ${data.days} days`}
                date={null}
              />
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <Stat
                label="Mentioned in answers"
                value={whole(data.mentionRate)}
                change={pointsChange(data.mentionChange, 0)}
              />
              <Stat label="Cited in answers" value={whole(data.citationRate)} />
              <Stat
                label="Answers collected"
                value={formatNumber(data.answered)}
              />
              <Stat label="Runs" value={formatNumber(data.runs)} />
            </div>
            <Link
              to="/p/$projectId/ai-visibility"
              params={{ projectId }}
              className="text-sm text-foreground underline"
            >
              Open AI Search
            </Link>
          </Frame>
        );
      }}
    </SourceCard>
  );
}

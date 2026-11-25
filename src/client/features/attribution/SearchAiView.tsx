import { EmptyState } from "@/client/components/EmptyState";
import { QueryState } from "@/client/components/QueryState";
import { Skeleton } from "@/client/components/ui/skeleton";
import { AiReferralPanel } from "./AiReferralPanel";
import { FindingsPanel } from "./FindingsPanel";
import { LandingPagesTable } from "./LandingPagesTable";
import { PageDetailSheet } from "./PageDetailSheet";
import type { ReportParams } from "./attributionQueries";
import {
  useAiReferrals,
  useFindings,
  useLandingPages,
} from "./searchAiQueries";

function splitPage(page: string | undefined) {
  if (!page) return null;
  const at = page.indexOf("/");
  return at > 0 ? { host: page.slice(0, at), path: page.slice(at) } : null;
}

/** Search and AI: which pages sessions land on, what they lead to, and what AI assistants send. */
export function SearchAiView({
  params,
  page,
  onPage,
}: {
  params: ReportParams;
  page: string | undefined;
  onPage: (page: string | undefined) => void;
}) {
  const landing = useLandingPages(params);
  const referrals = useAiReferrals(params);
  const findings = useFindings(params);
  const open = (host: string, path: string) => onPage(`${host}${path}`);
  return (
    <div className="space-y-8">
      <QueryState
        query={findings}
        errorFallback="Could not load findings"
        loading={<Skeleton className="h-24" />}
      >
        {(data) => <FindingsPanel findings={data} params={params} />}
      </QueryState>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Landing pages</h2>
        <QueryState
          query={landing}
          errorFallback="Could not load landing pages"
        >
          {(data) =>
            data.pages.length === 0 ? (
              <EmptyState
                title="No landing pages recorded in this period"
                description="Pages appear once the tracker records visits. Outcomes are credited to the page a buyer first landed on under the selected model."
              />
            ) : (
              <LandingPagesTable landing={data} onOpen={open} />
            )
          }
        </QueryState>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">AI assistants</h2>
        <QueryState
          query={referrals}
          errorFallback="Could not load AI referrals"
        >
          {(data) => <AiReferralPanel referrals={data} onOpen={open} />}
        </QueryState>
      </section>

      <PageDetailSheet
        params={params}
        page={splitPage(page)}
        onClose={() => onPage(undefined)}
      />
    </div>
  );
}

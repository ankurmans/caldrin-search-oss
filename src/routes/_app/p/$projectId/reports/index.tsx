import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/client/components/PageHeader";
import { Button } from "@/client/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { createBasicReport } from "@/serverFunctions/command-centre";
import { useState } from "react";
import { MarketReport } from "@/client/features/reports/MarketReport";
import { ReportsList } from "@/client/features/reports/ReportsList";
import {
  DeleteReportModal,
  reportsQueryKey,
  useDeleteReport,
} from "@/client/features/reports/shared";
import { QueryState } from "@/client/components/QueryState";
import { listReports, type ReportListItem } from "@/serverFunctions/reports";
import { REPORT_APP_LIST_LIMIT } from "@/types/schemas/reports";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute("/_app/p/$projectId/reports/")({
  head: () => pageHead("Reports"),
  component: ReportsPage,
});

function ReportsPage() {
  const { projectId } = Route.useParams();
  const [pendingDelete, setPendingDelete] = useState<ReportListItem | null>(
    null,
  );

  const reportsQuery = useQuery({
    queryKey: reportsQueryKey(projectId),
    queryFn: () =>
      listReports({ data: { projectId, limit: REPORT_APP_LIST_LIMIT } }),
    // This page exists to inspect what an agent just wrote; the app-wide
    // 5-minute staleTime would show a pre-save list as current.
    staleTime: 0,
  });

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const summary = useMutation({
    mutationFn: () => createBasicReport({ data: { projectId } }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: reportsQueryKey(projectId),
      });
      void navigate({
        to: "/p/$projectId/reports/$reportId",
        params: { projectId, reportId: result.reportId },
      });
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not create report")),
  });

  const deleteMutation = useDeleteReport(projectId, () =>
    setPendingDelete(null),
  );

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader
          title="Reports"
          description="Summaries built from stored data, and HTML reports your agents saved to this project."
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                nativeButton={false}
                render={
                  <Link
                    to="/p/$projectId/reports/templates"
                    params={{ projectId }}
                  />
                }
              >
                Templates
              </Button>
              <Button
                pending={summary.isPending}
                onClick={() => summary.mutate()}
              >
                Create summary report
              </Button>
            </div>
          }
        />

        <MarketReport
          projectId={projectId}
          onSaved={(reportId) => {
            void queryClient.invalidateQueries({
              queryKey: reportsQueryKey(projectId),
            });
            void navigate({
              to: "/p/$projectId/reports/$reportId",
              params: { projectId, reportId },
            });
          }}
        />

        <QueryState query={reportsQuery} errorFallback="Failed to load reports">
          {(data) => (
            <ReportsList
              projectId={projectId}
              reports={data.reports}
              onDelete={setPendingDelete}
            />
          )}
        </QueryState>
      </div>

      {pendingDelete ? (
        <DeleteReportModal
          title={pendingDelete.title}
          isPending={deleteMutation.isPending}
          onClose={() => setPendingDelete(null)}
          onConfirm={() => deleteMutation.mutate(pendingDelete.id)}
        />
      ) : null}
    </div>
  );
}

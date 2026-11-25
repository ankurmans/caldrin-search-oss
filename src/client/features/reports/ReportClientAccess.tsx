import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getReportClientAccess,
  updateReportClientAccess,
} from "@/serverFunctions/clientReports";

export function ReportClientAccess({
  projectId,
  reportId,
  updatedAt,
}: {
  projectId: string;
  reportId: string;
  updatedAt: string;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["report-client-access", projectId, reportId, updatedAt];
  const access = useQuery({
    queryKey,
    queryFn: () => getReportClientAccess({ data: { projectId, reportId } }),
    staleTime: 0,
  });
  const update = useMutation({
    mutationFn: (visible: boolean) =>
      updateReportClientAccess({
        data: { projectId, reportId, updatedAt, visible },
      }),
    onSuccess: (_, visible) => {
      void queryClient.invalidateQueries({ queryKey });
      toast.success(
        visible
          ? "Report published to client logins"
          : "Report removed from client logins",
      );
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(error, "Could not update client access"),
      ),
  });

  if (!access.data) return null;
  const { visible, available } = access.data;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
      <div>
        <p className="font-medium">Client logins</p>
        <p className="text-xs text-muted-foreground">
          {visible && available
            ? "Visible to signed-in client guests assigned to this project."
            : "Give signed-in clients access to this report from their workspace."}
        </p>
      </div>
      {visible || available ? (
        <Button
          size="sm"
          variant="outline"
          pending={update.isPending}
          onClick={() => update.mutate(!visible)}
        >
          {visible ? "Remove client access" : "Publish to clients"}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link to="/settings/billing" hash="workspace-plans" />}
        >
          See Agency
        </Button>
      )}
    </div>
  );
}

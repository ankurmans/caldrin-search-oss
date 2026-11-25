import { useQuery } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { getAttributionInstallStatusFn } from "@/serverFunctions/attribution";
import { attributionKey } from "./useAttributionSetup";

export function AttributionInstallCheck({ projectId }: { projectId: string }) {
  const status = useQuery({
    queryKey: attributionKey(projectId, "install-status"),
    queryFn: () => getAttributionInstallStatusFn({ data: { projectId } }),
    enabled: false,
  });
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground">
        Open your website and run <code>caldrin("test")</code> in the browser
        console.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={status.isFetching}
        onClick={() => void status.refetch()}
      >
        Check for test event
      </Button>
      {status.data ? (
        <ul aria-live="polite" className="text-xs text-muted-foreground">
          <li>
            Test event:{" "}
            {status.data.receivedTestEvent
              ? `received ${status.data.lastTestAt?.slice(0, 16).replace("T", " ")} UTC`
              : "not received"}
          </li>
          <li>
            Real traffic:{" "}
            {status.data.receivedRealTraffic
              ? `last seen ${status.data.lastRealAt?.slice(0, 16).replace("T", " ")} UTC`
              : "none yet"}
          </li>
        </ul>
      ) : null}
    </div>
  );
}

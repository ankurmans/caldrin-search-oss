import { Badge } from "@/client/components/ui/badge";
import {
  SOURCE_LABELS,
  STATUS_LABELS,
  type OpportunityRowData,
} from "./helpers";

const PRIORITY_VARIANT = {
  high: "default",
  medium: "info",
  low: "secondary",
} as const;

export function PriorityBadge({
  priority,
}: {
  priority: OpportunityRowData["priority"];
}) {
  if (!priority) return <Badge variant="outline">Unranked</Badge>;
  return (
    <Badge variant={PRIORITY_VARIANT[priority]}>
      {priority.charAt(0).toUpperCase() + priority.slice(1)} priority
    </Badge>
  );
}

export function SourceBadge({
  source,
}: {
  source: OpportunityRowData["dataSource"];
}) {
  if (source === "simulated") {
    return <Badge variant="warning">Demo data</Badge>;
  }
  return <Badge variant="outline">{SOURCE_LABELS[source]}</Badge>;
}

export function StatusBadge({
  status,
}: {
  status: OpportunityRowData["status"];
}) {
  if (status === "open") return null;
  return (
    <Badge variant={status === "dismissed" ? "secondary" : "success"}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function StaleBadge() {
  return (
    <Badge variant="warning">No longer found in the latest analysis</Badge>
  );
}

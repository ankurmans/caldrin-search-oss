import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { SectionHeader } from "@/client/components/PageHeader";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonCard } from "@/client/components/SkeletonPresets";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { organizationContextQueryOptions } from "@/client/features/team/organizationQueries";
import { downloadFile } from "@/client/lib/download";
import { hasOrgPermission } from "@/lib/org-permissions";
import { exportAuditLog, getAuditLog } from "@/serverFunctions/audit-log";
import { auditActionLabel, type AuditActorKind } from "@/shared/audit-log";

const ANY = "any";
const GROUPS = [
  { value: ANY, label: "All activity" },
  { value: "member.", label: "Team and access" },
  { value: "workspace.", label: "Keys and mode" },
  { value: "project.", label: "Projects" },
  { value: "spend.", label: "Spend limits" },
  { value: "ledger.", label: "Approvals" },
  { value: "content.", label: "Publishing" },
  { value: "integration.", label: "Integrations" },
  { value: "links.", label: "Link outreach" },
  { value: "agent.", label: "Agent changes" },
];
const ACTORS: { value: string; label: string }[] = [
  { value: ANY, label: "Anyone" },
  { value: "user", label: "People" },
  { value: "agent", label: "Agents" },
  { value: "system", label: "System" },
];

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function AuditLogPage() {
  const org = useQuery(organizationContextQueryOptions());
  const [group, setGroup] = useState(ANY);
  const [actor, setActor] = useState(ANY);
  const filter = {
    action: group === ANY ? undefined : group,
    actorKind:
      actor === ANY
        ? undefined
        : // The select only offers the three kinds.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          (actor as AuditActorKind),
  };

  const log = useInfiniteQuery({
    queryKey: ["audit-log", filter],
    initialPageParam: undefined as
      | { createdAt: string; id: string }
      | undefined,
    queryFn: ({ pageParam }) =>
      getAuditLog({ data: { ...filter, before: pageParam } }),
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: org.data
      ? hasOrgPermission(org.data.role, { organization: ["update"] })
      : false,
  });

  const exporter = useMutation({
    mutationFn: () => exportAuditLog({ data: filter }),
    onSuccess: (result) => {
      downloadFile(result.csv, "audit-log.csv", "text/csv");
      if (result.truncated) {
        toast.message(
          `Exported the newest ${result.rows} events. Narrow the filter for older ones.`,
        );
      }
    },
    onError: (error) => toast.error(error.message),
  });

  if (org.isLoading) return <SkeletonCard />;
  if (
    !org.data ||
    !hasOrgPermission(org.data.role, { organization: ["update"] })
  ) {
    return (
      <p className="text-sm text-muted-foreground">
        Only workspace owners and admins can read the audit log.
      </p>
    );
  }
  if (log.isError) {
    return <QueryError error={log.error} fallback="Could not load the log." />;
  }

  const rows = log.data?.pages.flatMap((page) => page.rows) ?? [];

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Audit log"
        hint="Who changed access, keys, spend, approvals and published content, and what agents changed. Kept for 400 days."
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={exporter.isPending}
            onClick={() => exporter.mutate()}
          >
            Export CSV
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={GROUPS}
          value={group}
          onValueChange={(next) => next && setGroup(next)}
        >
          <SelectTrigger size="sm" aria-label="Activity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUPS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={ACTORS}
          value={actor}
          onValueChange={(next) => next && setActor(next)}
        >
          <SelectTrigger size="sm" aria-label="Who">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTORS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {log.isLoading ? (
        <SkeletonCard />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing recorded yet for this filter.
        </p>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">
                    {when(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div>{row.actorLabel ?? row.actorKind}</div>
                    {row.actorKind === "agent" && row.actorClient ? (
                      <div className="text-xs text-muted-foreground">
                        via {row.actorClient}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div>{row.summary}</div>
                    <div className="text-xs text-muted-foreground">
                      {auditActionLabel(row.action)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.outcome === "success" ? "secondary" : "destructive"
                      }
                    >
                      {row.outcome}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
      {log.hasNextPage ? (
        <Button
          size="sm"
          variant="outline"
          disabled={log.isFetchingNextPage}
          onClick={() => log.fetchNextPage()}
        >
          Load older events
        </Button>
      ) : null}
    </section>
  );
}

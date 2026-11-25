import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CardShell } from "@/client/components/CardShell";
import { CopyButton } from "@/client/components/CopyButton";
import { QueryState } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Skeleton } from "@/client/components/ui/skeleton";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { formatRelativeTime } from "@/client/lib/relative-time";
import {
  createPaymentConnectorFn,
  importAttributionCsvFn,
  removeAttributionConnectorFn,
} from "@/serverFunctions/attributionReports";
import { useAttributionConnectors } from "./attributionQueries";
import { PosthogConnect } from "./AttributionPosthogCard";
import { AttributionRoutingCard } from "./AttributionRoutingCard";
import { AttributionSettingsCard } from "./AttributionSettingsCard";
import { attributionKey } from "./useAttributionSetup";

const CSV_HELP =
  "Columns: date (2026-11-03), event_type (payment, lead, deal_won, signup), amount and currency, plus any of customer_id, user_id, visitor_id, lead_id, order_id, source (what they said), url, and id.";

type Kind = "stripe" | "polar";

const PROVIDERS = {
  stripe: {
    name: "Stripe",
    summary: "Track successful charges and refunds.",
    placeholder: "Main Stripe account",
    secret: "whsec_…",
    help: (
      <>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            Create a webhook endpoint in Stripe for{" "}
            <code>charge.succeeded</code>, <code>refund.created</code>,{" "}
            <code>refund.updated</code> and{" "}
            <code>checkout.session.completed</code>.
          </li>
          <li>
            Enter its signing secret here, then paste the Caldrin webhook URL
            into your Stripe endpoint.
          </li>
        </ol>
        <p>
          Add <code>cldr_visitor_id</code> to payment metadata to link a payment
          to its visit.
        </p>
      </>
    ),
  },
  polar: {
    name: "Polar",
    summary: "Track paid orders and refunds before tax.",
    placeholder: "Main Polar organization",
    secret: "Signing secret",
    help: (
      <>
        <p>
          Use your production organization. Polar leaves sandbox events
          unmarked.
        </p>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            In Polar, go to <strong>Settings → Webhooks → Add Endpoint</strong>.
            Choose <strong>Raw</strong> and the latest API version.
          </li>
          <li>
            Select <code>order.paid</code>, <code>refund.created</code> and{" "}
            <code>refund.updated</code>. Save with a temporary URL such as{" "}
            <code>https://example.com</code>.
          </li>
          <li>
            Enter the endpoint secret here, then replace the temporary URL in
            Polar with the Caldrin webhook URL.
          </li>
        </ol>
        <p>
          To link a payment to its visit, set <code>cldr_visitor_id</code> in
          checkout metadata and use your user ID as the customer's external ID.
        </p>
      </>
    ),
  },
};

function PaymentConnect({
  projectId,
  kind,
}: {
  projectId: string;
  kind: Kind;
}) {
  const provider = PROVIDERS[kind];
  const queryClient = useQueryClient();
  const query = useAttributionConnectors(projectId);
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [addingMore, setAddingMore] = useState(false);
  const [products, setProducts] = useState("");
  const filter = products
    .split(/[\s,]+/)
    .filter(Boolean)
    .join(",");
  const suffix = kind === "polar" && filter ? `?product=${filter}` : "";
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: attributionKey(projectId) });
  const fail = (error: unknown) =>
    toast.error(getStandardErrorMessage(error, "That did not work"));

  const create = useMutation({
    mutationFn: () =>
      createPaymentConnectorFn({
        data: {
          projectId,
          kind,
          label: label.trim(),
          signingSecret: secret.trim(),
        },
      }),
    onSuccess: async (result) => {
      setCreated(result.id);
      setAddingMore(false);
      setLabel("");
      setSecret("");
      await refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      removeAttributionConnectorFn({ data: { projectId, id } }),
    onSuccess: refresh,
    onError: fail,
  });

  return (
    <QueryState
      query={query}
      loading={<Skeleton className="h-24 w-full" />}
      errorFallback="Failed to load connectors"
    >
      {({ connectors, webhookBase }) => (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{provider.summary}</p>
          <details className="group rounded-md border border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium group-open:border-b group-open:border-border">
              {provider.name} webhook setup
            </summary>
            <div className="space-y-2 px-3 py-2 text-sm text-muted-foreground">
              {provider.help}
            </div>
          </details>
          {connectors
            .filter((c) => c.kind === kind)
            .map((c) => (
              <div
                key={c.id}
                className="space-y-2 rounded-lg border border-border p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.label}</span>
                  <Badge variant={c.lastEventAt ? "success" : "outline"}>
                    {c.lastEventAt
                      ? `Last delivery ${formatRelativeTime(c.lastEventAt)}`
                      : "No delivery yet"}
                  </Badge>
                  {c.failedCount > 0 ? (
                    <Badge variant="warning">
                      {c.failedCount} refused ({c.lastFailure})
                    </Badge>
                  ) : null}
                  <Button
                    size="xs"
                    variant="ghost"
                    className="ml-auto"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(c.id)}
                  >
                    Remove
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">
                    {webhookBase}
                    {kind}/{c.id}
                    {suffix}
                  </code>
                  <CopyButton
                    value={`${webhookBase}${kind}/${c.id}${suffix}`}
                    label="Copy webhook URL"
                    successMessage="Webhook URL copied"
                  />
                </div>
                {created === c.id && (
                  <p className="text-xs text-muted-foreground">
                    Paste this webhook URL into your {provider.name} endpoint.
                  </p>
                )}
              </div>
            ))}
          {kind === "polar" && connectors.some((c) => c.kind === kind) && (
            <details className="space-y-2 text-sm">
              <summary className="cursor-pointer font-medium">
                Filter Polar products
              </summary>
              <div className="space-y-1.5">
                <Label htmlFor="polar-products">Product IDs</Label>
                <Input
                  id="polar-products"
                  name="polar-product-ids"
                  autoComplete="off"
                  value={products}
                  placeholder="Separate product IDs with commas"
                  onChange={(e) => setProducts(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Copy the updated webhook URL above into Polar. An empty filter
                  includes every product.
                </p>
              </div>
            </details>
          )}
          {connectors.some((c) => c.kind === kind) && !addingMore ? (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setAddingMore(true)}
            >
              Add another {provider.name} connector
            </Button>
          ) : (
            <form
              className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor={`${kind}-label`}>Name</Label>
                <Input
                  id={`${kind}-label`}
                  name={`${kind}-connector-name`}
                  autoComplete="off"
                  value={label}
                  placeholder={provider.placeholder}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${kind}-secret`}>Signing secret</Label>
                <Input
                  id={`${kind}-secret`}
                  name={`${kind}-signing-secret`}
                  type="password"
                  autoComplete="new-password"
                  value={secret}
                  placeholder={provider.secret}
                  onChange={(e) => setSecret(e.target.value)}
                />
              </div>
              <Button
                type="submit"
                disabled={!label.trim() || !secret.trim() || create.isPending}
              >
                Add {provider.name}
              </Button>
            </form>
          )}
        </div>
      )}
    </QueryState>
  );
}

function CsvImport({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      importAttributionCsvFn({
        data: {
          projectId,
          label: file?.name ?? "import",
          text: file?.text ?? "",
          dryRun,
        },
      }),
    onSuccess: async (result) => {
      if (result.imported) {
        toast.success(
          `${result.imported.accepted} added, ${result.imported.duplicate} already held`,
        );
        await queryClient.invalidateQueries({
          queryKey: attributionKey(projectId),
        });
      }
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "The import failed")),
  });
  const result = run.data;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{CSV_HELP}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          aria-label="CSV file"
          onChange={async (e) => {
            const picked = e.target.files?.[0];
            run.reset();
            setFile(
              picked ? { name: picked.name, text: await picked.text() } : null,
            );
          }}
        />
        <Button variant="outline" onClick={() => input.current?.click()}>
          {file ? file.name : "Choose a CSV"}
        </Button>
        <Button
          variant="outline"
          disabled={!file || run.isPending}
          onClick={() => run.mutate(true)}
        >
          Check it
        </Button>
        <Button
          disabled={!file || run.isPending || (result?.valid ?? 1) === 0}
          onClick={() => run.mutate(false)}
        >
          Import
        </Button>
      </div>
      {result ? (
        <div className="space-y-1 text-sm">
          <p>
            {result.valid} of {result.rowCount} rows are usable.
            {result.imported
              ? ` ${result.imported.accepted} added, ${result.imported.duplicate} already held.`
              : ""}
          </p>
          {result.errors.slice(0, 8).map((e) => (
            <p key={`${e.row}-${e.message}`} className="text-muted-foreground">
              {e.row ? `Row ${e.row}: ` : ""}
              {e.message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Independent stacks keep the next panel close when a connector expands. */
export function AttributionRevenueSourcesCard({
  projectId,
}: {
  projectId: string;
}) {
  return (
    <div className="grid items-start gap-4 @3xl:grid-cols-2">
      <div className="min-w-0 space-y-4">
        <CardShell title="Revenue attribution: Stripe">
          <PaymentConnect projectId={projectId} kind="stripe" />
        </CardShell>
        <CardShell title="Revenue attribution: Polar">
          <PaymentConnect projectId={projectId} kind="polar" />
        </CardShell>
        <AttributionRoutingCard projectId={projectId} />
      </div>
      <div className="min-w-0 space-y-4">
        <CardShell title="Revenue attribution: PostHog">
          <PosthogConnect projectId={projectId} />
        </CardShell>
        <CardShell title="Revenue attribution: import a CSV">
          <CsvImport projectId={projectId} />
        </CardShell>
        <AttributionSettingsCard projectId={projectId} />
      </div>
    </div>
  );
}

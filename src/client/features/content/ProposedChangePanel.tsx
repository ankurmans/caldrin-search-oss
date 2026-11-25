import { TriangleAlert } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import type { getShopifyChangePreview } from "@/serverFunctions/content";
import type { ShopifyActionName } from "./helpers";

export type Preview = Extract<
  Awaited<ReturnType<typeof getShopifyChangePreview>>,
  { ok: true }
>["data"];

export const ACTION_LABELS: Record<ShopifyActionName, string> = {
  create_draft: "Create an unpublished Shopify draft",
  update_existing: "Update an existing Shopify article",
  publish_draft: "Publish the Shopify draft",
};

export function ProposedChangePanel({ preview }: { preview: Preview }) {
  const failedBlocks = preview.checks.filter(
    (c) => c.severity === "block" && !c.passed,
  );
  return (
    <section
      className="space-y-3 rounded-lg border p-3"
      aria-label="Proposed change"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">
          Proposed change: {ACTION_LABELS[preview.action]}
        </h3>
        <Badge variant={preview.mode === "simulated" ? "info" : "outline"}>
          {preview.mode === "simulated"
            ? "Demo store"
            : preview.isDevelopmentStore
              ? "Development store"
              : "Live store"}
        </Badge>
        <Badge variant={preview.goesPublic ? "warning" : "success"}>
          {preview.goesPublic ? "Goes public" : "Not public"}
        </Badge>
        {preview.requiresConfirmUpdate ? (
          <Badge variant="warning">Replaces existing text</Badge>
        ) : null}
      </div>
      {preview.draftDestination ? (
        <p className="text-sm text-muted-foreground">
          Destination{" "}
          <strong className="font-medium text-foreground">
            {preview.draftDestination.blogTitle}
          </strong>{" "}
          · {preview.draftDestination.shopDomain}
        </p>
      ) : null}
      {preview.adapterVerified === "mock" && preview.mode === "live" ? (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>Live Shopify behavior is not verified yet</AlertTitle>
          <AlertDescription>
            Publishing has only been tested against a simulated store. Check the
            store after each change until a real store has been tried.
          </AlertDescription>
        </Alert>
      ) : null}
      {failedBlocks.length > 0 ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Blocked by quality checks</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {failedBlocks.map((c) => (
                <li key={c.key}>
                  <span className="font-medium">{c.key}</span>: {c.detail}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <State
          label="Before"
          empty="New article. Nothing exists in Shopify yet."
          state={preview.before}
        />
        <State label="After" state={preview.after} />
      </div>
      <DiffView text={preview.diff.text} unchanged={preview.diff.unchanged} />
      <p className="text-xs text-muted-foreground">
        {preview.diff.linesAdded} body lines added, {preview.diff.linesRemoved}{" "}
        removed.
      </p>
      <Links preview={preview} />
      <ul className="space-y-1">
        {preview.checks.map((c) => (
          <li key={c.key} className="text-xs">
            <span className={c.passed ? "text-success" : "text-destructive"}>
              {c.passed ? "Pass" : c.severity === "block" ? "Blocked" : "Warn"}
            </span>{" "}
            <span className="font-medium">{c.key}</span>
            <span className="text-muted-foreground"> · {c.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function State({
  label,
  empty,
  state,
}: {
  label: string;
  empty?: string;
  state: {
    title: string;
    metaTitle: string;
    metaDescription: string;
    isPublished?: boolean;
  } | null;
}) {
  return (
    <div className="min-w-0 space-y-1 rounded-md bg-muted/40 p-3 text-xs">
      <p className="font-medium">{label}</p>
      {state ? (
        <>
          <p className="break-words">{state.title}</p>
          <p className="break-words text-muted-foreground">
            SEO title: {state.metaTitle || "none"}
          </p>
          <p className="break-words text-muted-foreground">
            SEO description: {state.metaDescription || "none"}
          </p>
          <p className="text-muted-foreground">
            Status: {state.isPublished ? "published" : "draft (not public)"}
          </p>
        </>
      ) : (
        <p className="text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

export function DiffView({
  text,
  unchanged,
}: {
  text: string;
  unchanged: boolean;
}) {
  if (unchanged) {
    return <p className="text-xs text-muted-foreground">No differences.</p>;
  }
  return (
    <pre
      aria-label="What changes"
      className="max-h-80 overflow-auto rounded-md border bg-card p-3 text-xs"
    >
      {text.split("\n").map((line, index) => (
        <span
          key={index}
          className={
            line.startsWith("+ ")
              ? "block whitespace-pre-wrap break-words text-success"
              : line.startsWith("- ")
                ? "block whitespace-pre-wrap break-words text-destructive"
                : "block whitespace-pre-wrap break-words text-muted-foreground"
          }
        >
          {line}
        </span>
      ))}
    </pre>
  );
}

function Links({ preview }: { preview: Preview }) {
  const { linkedProducts, linkedCollections } = preview;
  if (linkedProducts.length + linkedCollections.length === 0) return null;
  return (
    <div className="space-y-1 text-xs">
      {linkedProducts.length > 0 ? (
        <p className="text-muted-foreground">
          Links to products:{" "}
          {linkedProducts
            .map((p) => `${p.title}${p.available ? "" : " (unavailable)"}`)
            .join(", ")}
        </p>
      ) : null}
      {linkedCollections.length > 0 ? (
        <p className="text-muted-foreground">
          Links to collections:{" "}
          {linkedCollections.map((c) => c.title).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

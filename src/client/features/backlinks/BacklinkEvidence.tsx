import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/client/components/ui/dialog";
import type { BacklinksRow } from "./backlinksPageTypes";
import { formatCompactDate } from "./backlinksPageUtils";

const MISSING = "Not reported";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 border-t border-border py-1.5 text-sm first:border-t-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function text(value: string | number | null | undefined) {
  return value == null || value === "" ? (
    <span className="text-muted-foreground">{MISSING}</span>
  ) : (
    value
  );
}

function url(value: string | null) {
  return value ? (
    <SafeExternalLink
      url={value}
      label={value}
      className="inline-flex items-center gap-1 break-all underline-offset-4 hover:underline"
    />
  ) : (
    text(null)
  );
}

function linkState(row: BacklinksRow) {
  if (row.isLost) return "Lost: the provider no longer finds this link";
  if (row.isBroken) return "Live, pointing at a page that returns an error";
  return "Live at the provider's last visit";
}

/**
 * Everything the provider recorded about one link. Fields it did not report
 * read "Not reported" rather than being filled in. The surrounding text is
 * what the crawler captured at its last visit and may have changed since.
 */
export function BacklinkEvidence({ row }: { row: BacklinksRow }) {
  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="ghost" size="xs" />}
        aria-label={`Link evidence for ${row.urlFrom ?? row.domainFrom ?? "this link"}`}
      >
        Evidence
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Link evidence</DialogTitle>
          <DialogDescription>
            Recorded by the provider's crawler. Check the live page before you
            rely on it.
          </DialogDescription>
        </DialogHeader>
        <dl>
          <Field label="Linking page">{url(row.urlFrom)}</Field>
          <Field label="Page title">{text(row.pageTitle)}</Field>
          <Field label="Destination">{url(row.urlTo)}</Field>
          <Field label="Destination status">
            {text(row.targetStatusCode)}
            {row.targetRedirect ? ` (redirects to ${row.targetRedirect})` : ""}
          </Field>
          <Field label="Anchor">{text(row.anchor)}</Field>
          <Field label="Text before">{text(row.textBefore)}</Field>
          <Field label="Text after">{text(row.textAfter)}</Field>
          <Field label="Placement">{text(row.semanticLocation)}</Field>
          <Field label="Link type">{text(row.itemType)}</Field>
          <Field label="Follow">
            {row.isDofollow == null
              ? text(null)
              : row.isDofollow
                ? "dofollow"
                : "nofollow"}
          </Field>
          <Field label="rel attributes">
            {row.relAttributes.length > 0
              ? row.relAttributes.join(", ")
              : text(null)}
          </Field>
          <Field label="Page language">{text(row.pageLanguage)}</Field>
          <Field label="Platform">
            {row.platformTypes.length > 0
              ? row.platformTypes.join(", ")
              : text(null)}
          </Field>
          <Field label="Country">{text(row.domainCountry)}</Field>
          <Field label="Status">{linkState(row)}</Field>
          <Field label="First seen">{formatCompactDate(row.firstSeen)}</Field>
          <Field label="Previous visit">
            {formatCompactDate(row.prevSeen)}
          </Field>
          <Field label="Last seen">{formatCompactDate(row.lastSeen)}</Field>
          {row.isLost ? (
            <Field label="Lost">{formatCompactDate(row.lostDate)}</Field>
          ) : null}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

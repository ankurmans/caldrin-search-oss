import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "cn";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";

/**
 * One headline reading with a short source label, and the way into the detail.
 * How it is measured sits one click away in the info popover.
 */
export function Pulse({
  title,
  source,
  details,
  action,
  children,
}: {
  title: string;
  /** Where the number comes from, so first-party and estimated data never blur. */
  source?: string;
  /** How the number is measured and what limits how it can be read. */
  details?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="@container/pulse flex min-w-0 flex-col gap-3 p-4"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{title}</h2>
          {source ? (
            <p className="text-xs text-muted-foreground">{source}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {details ? (
            <Popover>
              <PopoverTrigger
                aria-label={`How ${title} is measured`}
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
              >
                <Info className="size-3.5" />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 text-xs">
                {details}
              </PopoverContent>
            </Popover>
          ) : null}
          {action}
        </div>
      </header>
      {children}
    </section>
  );
}

export function PulseNumber({
  label,
  value,
  title,
  note,
  tone = "neutral",
}: {
  label: string;
  value: string;
  /** The exact figure, shown on hover when `value` is shortened. */
  title?: string;
  note?: string | null;
  tone?: "neutral" | "good" | "bad";
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        title={title}
        className="truncate text-2xl leading-8 font-semibold tabular-nums"
      >
        {value}
      </dd>
      {note ? (
        <dd
          className={cn(
            "text-xs tabular-nums",
            tone === "good" && "text-green-700 dark:text-success",
            tone === "bad" && "text-red-700 dark:text-destructive",
            tone === "neutral" && "text-muted-foreground",
          )}
        >
          {note}
        </dd>
      ) : null}
    </div>
  );
}

/** A compact unavailable state: what is missing, and the one step that fixes it. */
export function PulseUnavailable({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-start justify-between gap-3">
      <p className="text-sm text-muted-foreground">{message}</p>
      {action}
    </div>
  );
}

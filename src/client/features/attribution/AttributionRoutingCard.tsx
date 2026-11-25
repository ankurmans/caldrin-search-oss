import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { CardShell } from "@/client/components/CardShell";
import { QueryState } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Skeleton } from "@/client/components/ui/skeleton";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { useAttributionSetup } from "@/client/features/attribution/useAttributionSetup";
import {
  addAttributionBrandFn,
  addAttributionSourceRuleFn,
  removeAttributionSourceRuleFn,
} from "@/serverFunctions/attribution";
import {
  CHANNELS,
  CHANNEL_LABELS,
  narrow,
} from "@/shared/attribution/vocabulary";

const MATCH_KINDS = [
  ["referrer_host", "Referrer host"],
  ["utm_source", "utm_source"],
  ["utm_medium", "utm_medium"],
  ["click_id", "Click id kind"],
] as const;

/** Operating brands under one project, and the project's own rules for reading a source. */
export function AttributionRoutingCard({ projectId }: { projectId: string }) {
  const { query, refresh } = useAttributionSetup(projectId);
  const [brand, setBrand] = useState("");
  const [matchKind, setMatchKind] =
    useState<(typeof MATCH_KINDS)[number][0]>("referrer_host");
  const [pattern, setPattern] = useState("");
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("referral");
  const [label, setLabel] = useState("");

  const addBrand = useMutation({
    mutationFn: () =>
      addAttributionBrandFn({ data: { projectId, name: brand.trim() } }),
    onSuccess: async (result) => {
      if (!result.added) toast.info("That brand already exists");
      setBrand("");
      await refresh();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const addRule = useMutation({
    mutationFn: () =>
      addAttributionSourceRuleFn({
        data: {
          projectId,
          matchKind,
          pattern: pattern.trim(),
          channel,
          sourceLabel: label.trim(),
        },
      }),
    onSuccess: async () => {
      setPattern("");
      setLabel("");
      toast.success("Rule added. Credits are rebuilt from recorded events.");
      await refresh();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const removeRule = useMutation({
    mutationFn: (id: string) =>
      removeAttributionSourceRuleFn({ data: { projectId, id } }),
    onSuccess: refresh,
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  return (
    <CardShell title="Revenue attribution: brands and source rules">
      <QueryState
        query={query}
        loading={<Skeleton className="h-32 w-full" />}
        errorFallback="Failed to load attribution setup"
      >
        {(setup) => (
          <div className="flex flex-col gap-5 text-sm">
            <section className="flex flex-col gap-2">
              <h3 className="font-medium">Brands</h3>
              <p className="text-xs text-muted-foreground">
                For a business with several operating names. A lead keeps the
                brand that received it and the brand it was meant for, so a lead
                in the wrong inbox shows up instead of being overwritten.
              </p>
              <div className="flex flex-wrap gap-2">
                {setup.brands.map((b) => (
                  <Badge key={b.id} variant="outline">
                    {b.name}
                  </Badge>
                ))}
              </div>
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (brand.trim()) addBrand.mutate();
                }}
              >
                <Input
                  value={brand}
                  onChange={(event) => setBrand(event.target.value)}
                  placeholder="Brand name"
                  aria-label="Brand name"
                  className="max-w-xs"
                />
                <Button
                  type="submit"
                  disabled={addBrand.isPending || !brand.trim()}
                >
                  Add brand
                </Button>
              </form>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="font-medium">Source rules</h3>
              <p className="text-xs text-muted-foreground">
                Your rules run before the built-in ones. Adding or removing one
                rebuilds credits from the recorded events.
              </p>
              {setup.sourceRules.length ? (
                <ul className="flex flex-col gap-1">
                  {setup.sourceRules.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
                    >
                      <span>
                        {r.matchKind} = <code>{r.pattern}</code>
                      </span>
                      <span className="text-muted-foreground">
                        read as {r.sourceLabel} (
                        {
                          CHANNEL_LABELS[
                            narrow(CHANNELS, r.channel) ?? "unknown"
                          ]
                        }
                        )
                      </span>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="ml-auto"
                        onClick={() => removeRule.mutate(r.id)}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <form
                className="grid gap-2 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (pattern.trim() && label.trim()) addRule.mutate();
                }}
              >
                <div className="flex flex-col gap-1">
                  <Label htmlFor="rule-kind">Match on</Label>
                  <select
                    id="rule-kind"
                    className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
                    value={matchKind}
                    onChange={(event) =>
                      setMatchKind(
                        MATCH_KINDS.find(
                          ([k]) => k === event.target.value,
                        )?.[0] ?? "referrer_host",
                      )
                    }
                  >
                    {MATCH_KINDS.map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="rule-pattern">Equals</Label>
                  <Input
                    id="rule-pattern"
                    value={pattern}
                    onChange={(event) => setPattern(event.target.value)}
                    placeholder="partner.example.com"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="rule-channel">Read as channel</Label>
                  <select
                    id="rule-channel"
                    className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
                    value={channel}
                    onChange={(event) =>
                      setChannel(
                        narrow(CHANNELS, event.target.value) ?? "unknown",
                      )
                    }
                  >
                    {CHANNELS.map((c) => (
                      <option key={c} value={c}>
                        {CHANNEL_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="rule-label">Source name</Label>
                  <Input
                    id="rule-label"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="Partner directory"
                  />
                </div>
                <div>
                  <Button
                    type="submit"
                    disabled={
                      addRule.isPending || !pattern.trim() || !label.trim()
                    }
                  >
                    Add rule
                  </Button>
                </div>
              </form>
            </section>
          </div>
        )}
      </QueryState>
    </CardShell>
  );
}

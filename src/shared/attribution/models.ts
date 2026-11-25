import { reverse, sort } from "remeda";
import type { Channel, Evidence, ModelKey } from "./vocabulary";

export type Touch = {
  id: string;
  occurredAt: string;
  channel: Channel;
  source: string | null;
  kind: "session" | "self_reported" | "call";
  /** Identity links between the outcome and this touchpoint: 0 when the outcome event carried the same visitor id. */
  linkDepth: number;
};

type Credit = {
  touchpointId: string | null;
  channel: Channel;
  source: string | null;
  creditBp: number;
  evidence: Evidence;
};

const TIME_DECAY_HALF_LIFE_DAYS = 7;
const DAY_MS = 86_400_000;

/** Shares 10000 basis points across weights; the remainder goes to the largest remainders. */
function allocate(weights: number[]) {
  const total = weights.reduce((sum, w) => sum + w, 0);
  const exact = weights.map((w) => (w / total) * 10000);
  const bp = exact.map(Math.floor);
  let left = 10000 - bp.reduce((sum, v) => sum + v, 0);
  const order = sort(
    exact.map((value, i) => ({ i, rest: value - Math.floor(value) })),
    (a, b) => b.rest - a.rest || a.i - b.i,
  );
  for (const { i } of order) {
    if (left <= 0) break;
    bp[i] = (bp[i] ?? 0) + 1;
    left -= 1;
  }
  return bp;
}

const unknown = (): Credit[] => [
  {
    touchpointId: null,
    channel: "unknown",
    source: null,
    creditBp: 10000,
    evidence: "unknown",
  },
];

function single(touch: Touch): Credit[] {
  return [
    {
      touchpointId: touch.id,
      channel: touch.channel,
      source: touch.source,
      creditBp: 10000,
      evidence: touch.linkDepth === 0 ? "observed" : "linked",
    },
  ];
}

function shared(touches: Touch[], weights: number[]): Credit[] {
  const bp = allocate(weights);
  return touches.map((touch, i) => ({
    touchpointId: touch.id,
    channel: touch.channel,
    source: touch.source,
    creditBp: bp[i] ?? 0,
    evidence: "modelled" as const,
  }));
}

/**
 * Splits one outcome's credit across the touchpoints recorded for the same
 * subject. Only touchpoints inside the lookback window and not from the
 * project's own site count. An outcome with nothing to credit stays unknown;
 * it is never handed to a known channel.
 */
export function computeCredits(
  model: ModelKey,
  outcomeAt: string,
  touches: readonly Touch[],
  lookbackDays: number,
): Credit[] {
  const end = Date.parse(outcomeAt);
  const start = end - lookbackDays * DAY_MS;
  const inWindow = sort(
    touches.filter((t) => {
      const at = Date.parse(t.occurredAt);
      return at >= start && at <= end && t.channel !== "internal";
    }),
    (a, b) =>
      a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
  );

  if (model === "self_reported") {
    const reported = inWindow.filter((t) => t.kind === "self_reported").at(-1);
    return reported
      ? [
          {
            touchpointId: reported.id,
            channel: reported.channel,
            source: reported.source,
            creditBp: 10000,
            evidence: "self_reported",
          },
        ]
      : unknown();
  }

  const seen = inWindow.filter((t) => t.kind !== "self_reported");
  const first = seen[0];
  const last = seen.at(-1);
  if (!first || !last) return unknown();
  if (seen.length === 1) return single(first);

  switch (model) {
    case "first_touch":
      return single(first);
    case "last_touch":
      return single(last);
    case "last_non_direct":
      return single(reverse(seen).find((t) => t.channel !== "direct") ?? last);
    case "linear":
      return shared(
        seen,
        seen.map(() => 1),
      );
    case "position_based": {
      if (seen.length === 2) return shared(seen, [1, 1]);
      const middle = 20 / (seen.length - 2);
      return shared(
        seen,
        seen.map((_, i) => (i === 0 || i === seen.length - 1 ? 40 : middle)),
      );
    }
    case "time_decay":
      return shared(
        seen,
        seen.map(
          (t) =>
            0.5 **
            ((end - Date.parse(t.occurredAt)) /
              DAY_MS /
              TIME_DECAY_HALF_LIFE_DAYS),
        ),
      );
  }
}

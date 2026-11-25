import { sort } from "remeda";

type Capture = {
  answerId: string;
  promptId: string;
  version: string | null;
  runAt: string;
  captured: boolean | null;
  query: string | null;
};

type PromptSample = {
  days: Set<string>;
  answers: Set<string>;
  queries: Map<string, Set<string>>;
};

function measure(rows: Capture[]) {
  const versions = new Set<string | null>();
  const answerIds = new Set<string>();
  const prompts = new Map<string, PromptSample>();
  for (const row of rows) {
    versions.add(row.version);
    answerIds.add(row.answerId);
    let sample = prompts.get(row.promptId);
    if (!sample) {
      sample = { days: new Set(), answers: new Set(), queries: new Map() };
      prompts.set(row.promptId, sample);
    }
    if (!row.captured) continue;

    sample.days.add(row.runAt.slice(0, 10));
    sample.answers.add(row.answerId);
    if (!row.query) continue;

    const answers = sample.queries.get(row.query) ?? new Set<string>();
    answers.add(row.answerId);
    sample.queries.set(row.query, answers);
  }
  return { versions, prompts, total: answerIds.size };
}

function queryShares(samples: Map<string, PromptSample>) {
  const shares = new Map<string, { share: number; answers: number }>();
  let total = 0;
  for (const sample of samples.values()) {
    total += sample.answers.size;
    for (const [query, answers] of sample.queries) {
      const point = shares.get(query) ?? { share: 0, answers: 0 };
      point.share += answers.size / sample.answers.size / samples.size;
      point.answers += answers.size;
      shares.set(query, point);
    }
  }
  return { shares, total };
}

const unavailable = (reason: string) => ({
  comparable: false as const,
  reason,
});

export function compareFanOut(
  rows: Capture[],
  dates: { start: string; split: string; end: string },
) {
  const before = measure(rows.filter((row) => row.runAt < dates.split));
  const after = measure(rows.filter((row) => row.runAt >= dates.split));

  if (!before.prompts.size || !after.prompts.size)
    return unavailable("Saved answers are needed in both periods.");
  if (
    new Set([...before.versions, ...after.versions]).size !== 1 ||
    before.versions.has(null) ||
    after.versions.has(null)
  )
    return unavailable(
      "Both periods need answers from the same saved prompt set.",
    );
  if (
    before.prompts.size !== after.prompts.size ||
    [...before.prompts.keys()].some((id) => !after.prompts.has(id))
  )
    return unavailable(
      "The set of prompts measured differs between these periods.",
    );
  if (
    [...before.prompts.values(), ...after.prompts.values()].some(
      (sample) => sample.days.size < 2,
    )
  )
    return unavailable(
      "Each measured prompt needs a reported search list on two collection days in each period.",
    );

  const earlier = queryShares(before.prompts);
  const recent = queryShares(after.prompts);
  const changes = [
    ...new Set([...earlier.shares.keys(), ...recent.shares.keys()]),
  ]
    .map((query) => {
      const from = earlier.shares.get(query);
      const to = recent.shares.get(query);
      const beforePct = Math.round((from?.share ?? 0) * 100);
      const afterPct = Math.round((to?.share ?? 0) * 100);
      return {
        query,
        beforePct,
        afterPct,
        beforeAnswers: from?.answers ?? 0,
        afterAnswers: to?.answers ?? 0,
        change: afterPct - beforePct,
      };
    })
    .filter((row) => row.change !== 0);
  const largestChanges = sort(
    changes,
    (a, b) =>
      Math.abs(b.change) - Math.abs(a.change) || a.query.localeCompare(b.query),
  ).slice(0, 10);
  return {
    comparable: true as const,
    dates,
    changes: largestChanges,
    beforeAnswers: earlier.total,
    beforeTotal: before.total,
    afterAnswers: recent.total,
    afterTotal: after.total,
    prompts: after.prompts.size,
  };
}

import { describe, expect, it, vi } from "vitest";
import { readAnswerPerception } from "../services/perceptionReading";
import { GOLD_SET, PERCEPTION_GATE } from "./perceptionGoldSet";

vi.mock("cloudflare:workers", () => ({ env: {} }));

// Calls the real model, so it runs only on request:
//   PERCEPTION_EVAL=1 ANTHROPIC_API_KEY=... pnpm exec vitest run perceptionGold.eval
// It is the gate for changing the classifier prompt, model or version.
const anthropicKey = process.env.ANTHROPIC_API_KEY;

describe.skipIf(!process.env.PERCEPTION_EVAL || !anthropicKey)(
  "perception classifier against the gold set",
  () => {
    it("meets the agreement gate", { timeout: 300_000 }, async () => {
      const access = { anthropicKey: anthropicKey ?? "" };
      const results: {
        gold: (typeof GOLD_SET)[number];
        read: Awaited<ReturnType<typeof readAnswerPerception>>;
      }[] = [];
      const queue = [...GOLD_SET];
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          for (let next = queue.shift(); next; next = queue.shift()) {
            const read = await readAnswerPerception({
              access,
              modelId: undefined,
              text: next.text,
              brands: next.brands,
            });
            results.push({ gold: next, read });
          }
        }),
      );
      let stance = 0;
      let sentiment = 0;
      let versus = 0;
      let versusTotal = 0;
      let total = 0;
      const misses: string[] = [];
      for (const { gold, read } of results) {
        for (const expected of gold.expected) {
          total += 1;
          const got = read.readings.find((r) => r.domain === expected.domain);
          if (got?.stance === expected.stance) stance += 1;
          else
            misses.push(
              `${gold.id} ${expected.domain} stance: want ${expected.stance}, got ${got?.stance ?? "none"}`,
            );
          if (got?.sentiment === expected.sentiment) sentiment += 1;
          else
            misses.push(
              `${gold.id} ${expected.domain} sentiment: want ${expected.sentiment}, got ${got?.sentiment ?? "none"}`,
            );
          if (expected.versus) {
            versusTotal += 1;
            if (
              got?.comparisons.some(
                (c) =>
                  c.competitorDomain === expected.versus?.domain &&
                  c.outcome === expected.versus.outcome,
              )
            )
              versus += 1;
            else
              misses.push(
                `${gold.id} ${expected.domain} versus ${expected.versus.domain}: want ${expected.versus.outcome}`,
              );
          }
        }
      }
      const model = results[0]?.read.model;
      console.log(
        JSON.stringify(
          {
            model,
            costPerAnswerUsd: +(
              results.reduce((sum, r) => sum + r.read.costUsd, 0) /
              results.length
            ).toFixed(5),
            cases: GOLD_SET.length,
            readings: total,
            stance: +(stance / total).toFixed(3),
            sentiment: +(sentiment / total).toFixed(3),
            comparisons: +(versus / versusTotal).toFixed(3),
            misses,
          },
          null,
          2,
        ),
      );
      expect(stance / total).toBeGreaterThanOrEqual(PERCEPTION_GATE.stance);
      expect(sentiment / total).toBeGreaterThanOrEqual(
        PERCEPTION_GATE.sentiment,
      );
    });
  },
);

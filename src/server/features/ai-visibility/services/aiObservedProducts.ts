import { countBy, groupBy, sort, unique } from "remeda";
import type { CitationGapInput } from "@/types/schemas/citation-gaps";
import { loadAnsweredWindow } from "@/server/features/citation-gaps/citationGapService";
import { AiObservationProductRepository } from "../repositories/aiObservationProductRepository";
import { isAnswered } from "./aiVisibilityIntelligenceMetrics";

const MAX_PRODUCTS = 50;

const normalize = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const mostCommon = (values: string[]) =>
  sort(Object.entries(countBy(values, (v) => v)), (a, b) => b[1] - a[1])[0][0];

/**
 * Product cards that engines showed in stored answers, grouped by title. Only
 * engines whose provider reports a products element can appear; an engine with
 * no cards is not evidence that it showed none.
 */
export async function getObservedProducts(input: CitationGapInput) {
  const { window, facts, runIds } = await loadAnsweredWindow(input);
  const answered = facts.filter(isAnswered);
  const rows = await AiObservationProductRepository.listForObservations(
    answered.map((f) => f.id),
  );
  const engineOf = new Map(answered.map((f) => [f.id, f.engine]));
  const withProducts = new Set(rows.map((r) => r.observationId));

  const products = sort(
    Object.values(groupBy(rows, (r) => normalize(r.title))),
    (a, b) =>
      unique(b.map((r) => r.observationId)).length -
      unique(a.map((r) => r.observationId)).length,
  )
    .slice(0, MAX_PRODUCTS)
    .map((group) => {
      const observations = unique(group.map((r) => r.observationId));
      const prices = group.filter((r) => r.price !== null && r.currency);
      return {
        name: mostCommon(group.map((r) => r.title)),
        answers: observations.length,
        averagePosition:
          Math.round(
            (group.reduce((sum, r) => sum + r.position, 0) / group.length) * 10,
          ) / 10,
        engines: Object.entries(
          countBy(observations, (id) => engineOf.get(id) ?? "unknown"),
        ).map(([engine, answers]) => ({ engine, answers })),
        prices: Object.entries(groupBy(prices, (r) => r.currency!)).map(
          ([currency, rs]) => ({
            currency,
            min: Math.min(...rs.map((r) => r.price!)),
            max: Math.max(...rs.map((r) => r.price!)),
          }),
        ),
        tags: unique(group.flatMap((r) => (r.tag ? [r.tag] : []))),
      };
    });

  return {
    window,
    coverage: {
      runs: runIds.length,
      answered: answered.length,
      answeredWithProducts: withProducts.size,
      engines: Object.entries(countBy(answered, (f) => f.engine)).map(
        ([engine, count]) => ({
          engine,
          answered: count,
          withProducts: answered.filter(
            (f) => f.engine === engine && withProducts.has(f.id),
          ).length,
        }),
      ),
    },
    products,
    notes: [
      "Only the title, price, currency and tag the engine's provider reports are stored. Merchant, link and rating are not reported, so none is shown.",
      "Counts are answers that listed the product out of the answers that showed any product cards, not out of every answer.",
    ],
  };
}

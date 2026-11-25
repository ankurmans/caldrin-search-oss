import type { SourceFilters } from "@/types/schemas/source-intelligence";
import { FanOutRepository } from "../repositories/FanOutRepository";
import { compareFanOut } from "../rules/compareFanOut";

const DAY_MS = 86_400_000;
const ROW_LIMIT = 20_000;

export async function loadFanOutComparison(
  projectId: string,
  filters: SourceFilters,
) {
  if (!filters.engine || !filters.locationCode || !filters.languageCode) {
    return {
      comparable: false as const,
      reason: "Select one engine and market to compare periods.",
    };
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const end = today.toISOString();
  const split = new Date(today.getTime() - filters.days * DAY_MS).toISOString();
  const start = new Date(
    today.getTime() - 2 * filters.days * DAY_MS,
  ).toISOString();
  const rows = await FanOutRepository.periodQueries(
    projectId,
    filters,
    start,
    end,
    ROW_LIMIT + 1,
  );
  if (rows.length > ROW_LIMIT) {
    return {
      comparable: false as const,
      reason:
        "Choose a shorter window or a prompt group to compare this sample.",
    };
  }

  return compareFanOut(rows, { start, split, end });
}

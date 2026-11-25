export type AiMarket = { locationCode: number; languageCode: string };
/** A market named by a reader; the language may be left out. */
export type AiMarketQuery = { locationCode: number; languageCode?: string };

/** The market a read asked for, or null when it did not name one. */
export function aiMarketQuery(input: {
  locationCode?: number;
  languageCode?: string;
}): AiMarketQuery | null {
  return input.locationCode === undefined
    ? null
    : { locationCode: input.locationCode, languageCode: input.languageCode };
}

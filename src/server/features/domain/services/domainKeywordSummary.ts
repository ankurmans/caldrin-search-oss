import { sortBy } from "remeda";
import { getDomainWithoutSuffix } from "tldts";
import type { z } from "zod";
import type { domainKeywordSchema } from "@/server/features/domain/services/domainKeywordsPage";

type SampleKeyword = z.infer<typeof domainKeywordSchema>;

type Bucket = { keywords: number; traffic: number };

type KeywordSummary = {
  sampleSize: number;
  intents: Record<string, Bucket>;
  // Keywords that contain the domain's own name. Null when the name is too
  // short to tell a brand search from any other keyword.
  nameMatch: { matching: Bucket; other: Bucket; term: string } | null;
  serpFeatures: { feature: string; keywords: number }[];
};

const MIN_NAME_LENGTH = 4;
const MAX_FEATURES = 8;

const alphanumeric = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

const empty = (): Bucket => ({ keywords: 0, traffic: 0 });

function add(bucket: Bucket, keyword: SampleKeyword) {
  bucket.keywords += 1;
  bucket.traffic += keyword.traffic ?? 0;
}

/**
 * Intent, name-match and SERP-feature counts over a keyword sample. A
 * distribution of a sample, not of the whole domain: the caller says how many
 * keywords it rests on.
 */
export function summarizeKeywordSample(
  keywords: SampleKeyword[],
  hostname: string,
): KeywordSummary {
  const intents: Record<string, Bucket> = {};
  const features = new Map<string, number>();
  const name = alphanumeric(getDomainWithoutSuffix(hostname) ?? hostname);
  const nameMatch =
    name.length >= MIN_NAME_LENGTH
      ? { matching: empty(), other: empty(), term: name }
      : null;

  for (const keyword of keywords) {
    add((intents[keyword.intent ?? "unclassified"] ??= empty()), keyword);
    if (nameMatch) {
      add(
        alphanumeric(keyword.keyword).includes(name)
          ? nameMatch.matching
          : nameMatch.other,
        keyword,
      );
    }
    for (const feature of new Set(keyword.serpFeatures)) {
      features.set(feature, (features.get(feature) ?? 0) + 1);
    }
  }

  return {
    sampleSize: keywords.length,
    intents,
    nameMatch,
    serpFeatures: sortBy(
      [...features].map(([feature, count]) => ({ feature, keywords: count })),
      [(row) => row.keywords, "desc"],
    ).slice(0, MAX_FEATURES),
  };
}

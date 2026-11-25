import { and, eq, sql } from "drizzle-orm";
import { aiMatches, aiPerceptions } from "@/db/schema";
import { PERCEPTION_CLASSIFIER_VERSION } from "@/shared/ai-perception";

/** Joins the perception reading of the same answer and brand, if one exists. */
export const perceptionOf = and(
  eq(aiPerceptions.observationId, aiMatches.observationId),
  eq(aiPerceptions.domain, aiMatches.domain),
  eq(aiPerceptions.classifierVersion, PERCEPTION_CLASSIFIER_VERSION),
);

/**
 * Whether the answer recommends the brand. A read answer uses its stance (a
 * person's correction wins), so this page and Perception never disagree; an
 * answer not read yet keeps the phrase detector's verdict.
 */
export const recommendedOf = sql<
  boolean | null
>`CASE coalesce(${aiPerceptions.reviewedStance}, ${aiPerceptions.stance}) WHEN 'recommended' THEN TRUE WHEN 'discouraged' THEN FALSE WHEN 'described' THEN NULL ELSE ${aiMatches.recommended} END`;

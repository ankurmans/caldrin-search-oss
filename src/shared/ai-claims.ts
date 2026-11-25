import { z } from "zod";

export const claimCategories = [
  "product",
  "feature",
  "pricing",
  "billing",
  "limits",
  "availability",
  "integration",
  "engines",
  "api",
  "market",
  "identity",
  "licensing",
  "security",
  "other",
] as const;

const optionalQualifier = z.string().trim().min(1).max(120).nullable();
export const claimProposition = z.object({
  subject: z.string().trim().min(1).max(120),
  predicate: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(300),
  polarity: z.enum(["asserts", "denies"]),
  plan: optionalQualifier,
  market: optionalQualifier,
  product: optionalQualifier,
  version: optionalQualifier,
  condition: optionalQualifier,
});

export const claimFactInput = claimProposition
  .extend({
    effectiveFrom: z.iso.date(),
    effectiveUntil: z.iso.date().nullable(),
    sourceUrl: z
      .url({ protocol: /^https?$/ })
      .max(1200)
      .nullable(),
    evidence: z.string().trim().min(10).max(500),
    previousId: z.uuid().optional(),
    legacyFactId: z.string().max(100).optional(),
  })
  .refine(
    (fact) => !fact.effectiveUntil || fact.effectiveUntil > fact.effectiveFrom,
    {
      message: "Expiry must be after the effective date.",
    },
  );

export type ClaimProposition = z.infer<typeof claimProposition>;

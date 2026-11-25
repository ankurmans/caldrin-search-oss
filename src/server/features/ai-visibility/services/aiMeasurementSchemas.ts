import { z } from "zod";
import { MAX_RUNS_PER_SIDE } from "./aiMeasurementTypes";

const isoInstant = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Use an ISO date-time.")
  .transform((value) => new Date(value).toISOString());

const windowSchema = z
  .object({ start: isoInstant, end: isoInstant })
  .refine((w) => w.start < w.end, "The window must end after it starts.");

const marketQuery = {
  locationCode: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Read only runs collected in this country (a market the tracker checks). Applies to windows; run ids name their own market.",
    ),
  languageCode: z.string().min(2).max(10).optional(),
};

const runIds = z.array(z.string().min(1)).min(1).max(MAX_RUNS_PER_SIDE);

const compareFields = {
  beforeRunIds: runIds.optional(),
  beforeWindow: windowSchema.optional(),
  afterRunIds: runIds.optional(),
  afterWindow: windowSchema.optional(),
  ...marketQuery,
};

type Sides = {
  beforeRunIds?: unknown;
  beforeWindow?: unknown;
  afterRunIds?: unknown;
  afterWindow?: unknown;
};
const oneSidePerKind = (v: Sides) => !!v.beforeRunIds !== !!v.beforeWindow;
const oneAfterPerKind = (v: Sides) => !!v.afterRunIds !== !!v.afterWindow;

export const compareWindowsInputSchema = z
  .object(compareFields)
  .refine(oneSidePerKind, {
    message: "Give the before side as beforeRunIds or beforeWindow, not both.",
  })
  .refine(oneAfterPerKind, {
    message: "Give the after side as afterRunIds or afterWindow, not both.",
  });

/** The same input with a project id, for the agent tool. */
export const compareWindowsToolSchema = z
  .object({ projectId: z.string().uuid(), ...compareFields })
  .refine(oneSidePerKind, {
    message: "Give the before side as beforeRunIds or beforeWindow, not both.",
  })
  .refine(oneAfterPerKind, {
    message: "Give the after side as afterRunIds or afterWindow, not both.",
  });

export type CompareWindowsInput = z.infer<typeof compareWindowsInputSchema>;

export const linkRunsInputSchema = z.object({
  entryId: z.string().min(1),
  baselineRunIds: runIds,
  followUpRunIds: runIds,
});
export type LinkRunsInput = z.infer<typeof linkRunsInputSchema>;

export const listRunsInputSchema = z
  .object({
    from: isoInstant.optional(),
    to: isoInstant.optional(),
    ...marketQuery,
  })
  .refine((v) => !v.from || !v.to || v.from < v.to, {
    message: "The range must end after it starts.",
  });
export type ListRunsInput = z.infer<typeof listRunsInputSchema>;

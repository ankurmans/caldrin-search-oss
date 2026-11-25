import { z } from "zod";
import { getConversionEvidence } from "@/server/features/attribution/services/attributionEvidence";
import { getAttributionHealth } from "@/server/features/attribution/services/attributionHealth";
import { getLandingPages } from "@/server/features/attribution/services/attributionLanding";
import { getLeadsReport } from "@/server/features/attribution/services/attributionLeads";
import { getCallsReport } from "@/server/features/attribution/services/attributionCalls";
import {
  compareAttributionModels,
  getAttributionOverview,
  type ReportQuery,
} from "@/server/features/attribution/services/attributionReports";
import { getBrandRouting } from "@/server/features/attribution/services/attributionRouting";
import { AttributionLedgerRepository as ledger } from "@/server/features/attribution/repositories/AttributionLedgerRepository";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { RANGE_KEYS } from "@/shared/attribution/ranges";
import { MODEL_KEYS } from "@/shared/attribution/vocabulary";

// Revenue Intelligence for an agent. Everything is read from the stored
// ledger, never changes it, calls no provider and uses no credits. Labelled
// demo data is never returned. Figures keep the evidence level the app shows:
// an outcome with no recorded source stays Unknown.

const readOnly = {
  readOnlyHint: true,
  openWorldHint: false,
  destructiveHint: false,
} as const;

const reportInput = {
  projectId: projectIdSchema,
  range: z
    .enum(RANGE_KEYS)
    .default("28d")
    .describe("Period ending now: 7d, 28d, 90d or 365d."),
  model: z
    .enum(MODEL_KEYS)
    .optional()
    .describe("Attribution model. Defaults to the project's own."),
  brand: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe("Only enquiries received by, or meant for, this brand."),
} as const;

type ReportArgs = {
  projectId: string;
  range: (typeof RANGE_KEYS)[number];
  model?: (typeof MODEL_KEYS)[number];
  brand?: string;
};

const loose = z.looseObject({ ...optionalMetaOutputSchema });

/** Resolves a brand name or slug to its id, or says which brands exist. */
async function reportQuery(
  args: ReportArgs,
): Promise<{ query: ReportQuery } | { error: string }> {
  let brandId: string | null = null;
  if (args.brand) {
    const wanted = args.brand.toLowerCase();
    const brands = await ledger.listBrands(args.projectId);
    const found = brands.find(
      (b) => b.slug === wanted || b.name.toLowerCase() === wanted,
    );
    if (!found)
      return {
        error: `No brand named "${args.brand}". Known brands: ${brands.map((b) => b.name).join(", ") || "none"}.`,
      };
    brandId = found.id;
  }
  return {
    query: {
      projectId: args.projectId,
      range: args.range,
      model: args.model,
      demo: false,
      brandId,
    },
  };
}

const refused = (text: string) =>
  mcpResponse({ text, structuredContent: { refused: true, reason: text } });

type ReportToolArgs = ReportArgs;

/** Resolves the brand, runs the report and wraps the result for the agent. */
async function reportResponse<A extends ReportArgs>(
  args: A,
  context: Parameters<typeof buildProjectMeta>[0],
  path: string,
  run: (
    query: ReportQuery,
  ) => Promise<{ text: string; data: Record<string, unknown> }>,
) {
  const resolved = await reportQuery(args);
  if ("error" in resolved) return refused(resolved.error);
  const { text, data } = await run(resolved.query);
  return mcpResponse({
    text,
    meta: buildProjectMeta(
      context,
      args.projectId,
      `/p/${args.projectId}/attribution${path}`,
    ),
    structuredContent: data,
  });
}

const reportConfig = <Extra extends z.ZodRawShape = Record<never, never>>(
  title: string,
  description: string,
  extra?: Extra,
) => ({
  title,
  description,
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- extra is only omitted when Extra is the empty default
  inputSchema: { ...reportInput, ...extra } as typeof reportInput & Extra,
  outputSchema: loose,
  annotations: readOnly,
});

export const getAttributionOverviewTool = {
  name: "get_attribution_overview",
  config: reportConfig(
    "Get revenue attribution overview",
    "Where signups, leads and revenue came from, by channel, with how well each is known (Observed, Linked, Self-reported, Unknown) and the share of outcomes with no recorded source. Revenue is net of refunds and kept per currency. Reads stored first-party events and connected payments; nothing is guessed, and Unknown outcomes are never moved to a channel.",
  ),
  handler: withMcpProjectAuth(async (args: ReportToolArgs, context) =>
    reportResponse(args, context, "", async (query) => {
      const o = await getAttributionOverview(query);
      return {
        text: `Model ${o.model}. ${o.unknownBp / 100}% of credited outcomes have no recorded source.`,
        data: { ...o },
      };
    }),
  ),
};

export const compareAttributionModelsTool = {
  name: "compare_attribution_models",
  config: reportConfig(
    "Compare attribution models",
    "The same outcomes credited by every model, side by side, per channel, with the lowest and highest answer and a model-dependent flag where the models differ by half again or more. Use it before stating that one channel beats another: a model-dependent channel is a range, not a finding.",
    {
      kind: z
        .enum([
          "payment",
          "lead",
          "signup",
          "qualified_lead",
          "call",
          "deal_won",
        ])
        .default("payment")
        .describe("The outcome to compare."),
    },
  ),
  handler: withMcpProjectAuth(
    async (args: ReportToolArgs & { kind: string }, context) =>
      reportResponse(args, context, "", async (query) => {
        const c = await compareAttributionModels({ ...query, kind: args.kind });
        return {
          text: `${c.rows.filter((r) => r.modelDependent).length} of ${c.rows.length} channels are model-dependent for ${args.kind}.`,
          data: { ...c },
        };
      }),
  ),
};

export const getAttributionLeadsTool = {
  name: "get_attribution_leads",
  config: reportConfig(
    "Get leads and revenue",
    "Enquiries from forms, email, calls, a CRM or chat. pipeline gives each person's furthest recorded stage with won contract value, collected cash and open pipeline kept separate (recognised revenue is not computed), and what buyers wrote about how they found you, exactly as written; 'Google' is search of an unspecified type, never organic. routing lists enquiries received by a brand other than the one they were meant for. calls reports status, source and handoff; calls of 60 seconds or more are a proxy, never a qualified lead, job or revenue. People are joined only by ids systems sent together. Figures are incomplete while pendingEvents is above zero.",
    {
      view: z
        .enum(["pipeline", "routing", "calls"])
        .default("pipeline")
        .describe(
          "pipeline, routing (brand received versus meant for) or calls.",
        ),
    },
  ),
  handler: withMcpProjectAuth(
    async (
      args: ReportToolArgs & { view: "pipeline" | "routing" | "calls" },
      context,
    ) =>
      reportResponse(args, context, "?view=leads", async (query) => {
        if (args.view === "routing") {
          const r = await getBrandRouting(query);
          return {
            text: "Brand routing is in the structured result.",
            data: { ...r },
          };
        }
        if (args.view === "calls") {
          const c = await getCallsReport(query);
          return {
            text: "Call outcomes are in the structured result.",
            data: { ...c },
          };
        }
        const l = await getLeadsReport(query);
        return {
          text: `Leads and revenue are in the structured result. Pending events: ${l.pendingEvents}.`,
          data: { ...l },
        };
      }),
  ),
};

export const getAttributionLandingPagesTool = {
  name: "get_attribution_landing_pages",
  config: reportConfig(
    "Get landing pages and outcomes",
    "Landing pages with the sessions that arrived there and the outcomes and revenue the model credits to them (first-party, Observed or Linked), beside Search Console clicks for the page when connected (Associated: about the page, not the visitors). Pages with sessions and no outcomes are shown, not hidden.",
  ),
  handler: withMcpProjectAuth(async (args: ReportToolArgs, context) =>
    reportResponse(args, context, "?view=search", async (query) => {
      const p = await getLandingPages(query);
      return {
        text: `${p.pages.length} landing pages${p.truncated ? ` (${p.truncated} more not shown)` : ""}.`,
        data: { ...p },
      };
    }),
  ),
};

export const getAttributionEvidenceTool = {
  name: "get_attribution_evidence",
  config: {
    title: "Get the evidence behind an outcome",
    description:
      "For one outcome (a conversion id from get_attribution_overview journeys or an app link): the event that reported it, the identities joined and why each join was made or refused, every visit that was considered with the rule that classified it, and what each model credited. Use it to explain a number rather than assert it.",
    inputSchema: {
      projectId: projectIdSchema,
      conversionId: z.string().trim().min(1).max(100),
    },
    outputSchema: loose,
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(
    async (args: { projectId: string; conversionId: string }, context) => {
      const evidence = await getConversionEvidence(
        args.projectId,
        args.conversionId,
      );
      if (!evidence) return refused("No outcome with that id in this project.");
      return mcpResponse({
        text: "Evidence for the outcome is in the structured result.",
        meta: buildProjectMeta(
          context,
          args.projectId,
          `/p/${args.projectId}/attribution?conversion=${encodeURIComponent(args.conversionId)}`,
        ),
        structuredContent: { ...evidence },
      });
    },
  ),
};

export const getAttributionHealthTool = {
  name: "get_attribution_health",
  config: {
    title: "Get revenue attribution health",
    description:
      "Whether revenue attribution is working: what arrived in the last 7 days and from where, how much is still Unknown, events refused and why, identity conflicts, and events still being processed. Check it before trusting a figure.",
    inputSchema: { projectId: projectIdSchema },
    outputSchema: loose,
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const health = await getAttributionHealth(args.projectId, false);
    return mcpResponse({
      text: "Health is in the structured result.",
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/attribution?view=health`,
      ),
      structuredContent: { ...health },
    });
  }),
};

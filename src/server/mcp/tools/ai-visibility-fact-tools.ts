import { z } from "zod";
import { defineAiTool } from "./ai-visibility-tool-factory";
import { aiProjectSchema } from "@/types/schemas/ai-visibility";
import {
  addBrandFactSchema,
  checkBrandFactsSchema,
  factCheckReportSchema,
  removeBrandFactSchema,
} from "@/types/schemas/ai-fact-checks";

const factIdOutput = z.looseObject({ id: z.string() });

export const listBrandFactsTool = defineAiTool({
  name: "list_brand_facts",
  title: "List brand facts",
  input: aiProjectSchema,
  output: z.looseObject({
    facts: z.array(z.looseObject({ id: z.string(), statement: z.string() })),
  }),
  readOnly: true,
  description:
    "The statements the project's owner says are true about the brand, such as prices, dates and what a product includes. AI answers are checked against them with check_brand_facts. Uses no credits.",
  execute: async (s, a) => ({ facts: await s.listBrandFacts(a) }),
  summarize: (d) => `${d.facts.length} brand facts.`,
});

export const addBrandFactTool = defineAiTool({
  name: "add_brand_fact",
  title: "Add a brand fact",
  input: addBrandFactSchema,
  output: factIdOutput,
  readOnly: false,
  description:
    "Save one plain statement that is true about the brand, up to 20 per project. Adding the same statement again returns the existing one. Only add facts the owner has confirmed: answers that disagree with them are reported as contradictions. Uses no credits.",
  execute: (s, a) => s.addBrandFact(a),
  summarize: (d) => `Saved brand fact ${d.id}.`,
});

export const removeBrandFactTool = defineAiTool({
  name: "remove_brand_fact",
  title: "Remove a brand fact",
  input: removeBrandFactSchema,
  output: z.looseObject({ removed: z.boolean() }),
  readOnly: false,
  description:
    "Remove one brand fact and the checks recorded against it. Uses no credits.",
  execute: async (s, a) => {
    await s.removeBrandFact(a);
    return { removed: true };
  },
  summarize: () => "Removed the brand fact and its checks.",
});

export const checkBrandFactsTool = defineAiTool({
  name: "check_brand_facts",
  title: "Check AI answers against brand facts",
  input: checkBrandFactsSchema,
  output: z.looseObject({
    runId: z.string(),
    facts: z.number(),
    answersRead: z.number(),
    checksSaved: z.number(),
    remaining: z.number(),
    costUsd: z.number(),
  }),
  readOnly: false,
  openWorld: true,
  description:
    "Read the stored answers of one run that name your brand against the project's brand facts, and record for each pair whether the answer supports the fact, contradicts it, or does not address it, with the quoted words and the model that read it. Only pairs not yet checked are sent to a small model, up to 40 answers per call, so a repeat call on a checked run costs nothing; remaining counts answers left for another call. Costs a few cents of model credits. It never collects new answers. Read the result with get_fact_check_report.",
  execute: (s, a, b) => s.checkBrandFacts(a, b),
  summarize: (d) =>
    `Read ${d.answersRead} answers against ${d.facts} facts, ${d.checksSaved} checks saved, $${d.costUsd.toFixed(4)}.${d.remaining ? ` ${d.remaining} more answers are unchecked: call again to continue.` : ""}`,
});

export const getFactCheckReportTool = defineAiTool({
  name: "get_fact_check_report",
  title: "Get brand fact-check report",
  input: factCheckReportSchema,
  output: z.looseObject({
    runId: z.string().nullable(),
    answersNamingBrand: z.number(),
    facts: z.array(
      z.looseObject({
        id: z.string(),
        statement: z.string(),
        supported: z.number(),
        contradicted: z.number(),
        notAddressed: z.number(),
        unchecked: z.number(),
      }),
    ),
    notes: z.array(z.string()),
  }),
  readOnly: true,
  description:
    "Per brand fact, how many answers of a run support it, contradict it, do not address it or are not yet checked, with the engine, prompt and quoted words behind each contradiction. Defaults to the newest finished run. A verdict is a small model's reading of a saved answer, not a ruling: open the answer with get_ai_visibility_answer before acting. Uses no credits.",
  execute: (s, a) => s.factCheckReport(a),
  summarize: (d) => {
    const bad = d.facts.reduce((n, f) => n + f.contradicted, 0);
    return `${d.facts.length} facts checked against ${d.answersNamingBrand} answers naming the brand: ${bad} contradictions.`;
  },
});

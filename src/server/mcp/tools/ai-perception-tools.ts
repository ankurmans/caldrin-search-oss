import { z } from "zod";
import {
  getAiPerceptionSchema,
  reviewAiPerceptionSchema,
} from "@/types/schemas/ai-perception";
import { defineAiTool } from "./ai-visibility-tool-factory";

export const getAiPerceptionTool = defineAiTool({
  name: "get_ai_perception",
  title: "Get how AI answers treat each brand",
  input: getAiPerceptionSchema,
  output: z.looseObject({
    runId: z.string().nullable(),
    classifierVersion: z.string(),
    answersWithText: z.number(),
    brandMentions: z.number(),
    totalReadings: z.number(),
    readings: z.array(
      z.looseObject({
        id: z.string(),
        brand: z.string(),
        stance: z.string(),
        sentiment: z.string(),
      }),
    ),
    notes: z.array(z.string()),
  }),
  readOnly: true,
  description:
    "The saved readings of how each stored answer of one run treats the brands it names: stance (recommended, described, discouraged), sentiment, confidence, the words in the answer the reading rests on, the strengths, weaknesses and buyer objections the answer states, and how it ranks the brand against competitors it names. Defaults to your own brand in the newest finished run; filter by brand, stance or sentiment. A person's correction is shown as the value, with the model's own reading beside it. Readings exist only for answers with text that name the brand, and only after classify_ai_visibility_sentiment has run for that run. Reads stored answers only and uses no credits.",
  execute: (s, a) => s.getPerceptionReadings(a),
  summarize: (d) =>
    `${d.totalReadings} readings of ${d.brandMentions} brand mentions across ${d.answersWithText} answers.`,
});

export const reviewAiPerceptionTool = defineAiTool({
  name: "review_ai_perception",
  title: "Correct a reading of an AI answer",
  input: reviewAiPerceptionSchema,
  output: z.looseObject({
    id: z.string(),
    stance: z.string(),
    sentiment: z.string(),
  }),
  readOnly: false,
  description:
    "Correct the stance or sentiment of one reading, for example when the model read a recommendation into a plain listing. The model's own reading is kept, and every correction is recorded with your note, so the history can be audited. Corrected values replace the model's in metrics and in get_ai_perception. Uses no credits.",
  execute: (s, a, b) => s.reviewPerception(a, b),
  summarize: (d) =>
    `Reading corrected: stance ${d.stance}, sentiment ${d.sentiment}.`,
});

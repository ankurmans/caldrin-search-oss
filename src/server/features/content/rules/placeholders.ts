import { PROSE_MAX_CHARS } from "@/types/schemas/projectContext";

// The gaps a draft leaves for facts only the merchant knows.
const PLACEHOLDER = /\[MERCHANT TO ADD:\s*([^\]]*?)\s*\]/g;

export const FACTS_SECTION_SLUG = "merchant-facts";

export type PlaceholderAnswer = { question: string; answer: string };

// Each distinct gap once, in the order it first appears.
export function findPlaceholders(html: string): string[] {
  return [
    ...new Set([...html.matchAll(PLACEHOLDER)].map((m) => m[1] ?? "")),
  ].filter((question) => question.length > 0);
}

const escapeText = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// Replaces every gap that has an answer with that answer as plain text; a gap
// with no answer stays in the draft.
export function fillPlaceholders(
  html: string,
  answers: PlaceholderAnswer[],
): string {
  const byQuestion = new Map(answers.map((a) => [a.question, a.answer.trim()]));
  return html.replace(PLACEHOLDER, (whole, question: string) => {
    const answer = byQuestion.get(question.trim());
    return answer ? escapeText(answer) : whole;
  });
}

const lineFor = ({ question, answer }: PlaceholderAnswer) => {
  const text = question.replaceAll(":", " ").trim();
  return `- ${text.charAt(0).toUpperCase()}${text.slice(1)}: ${answer.trim()}`;
};
const keyOf = (line: string) =>
  line.slice(2, line.indexOf(": ")).trim().toLowerCase();

// A fact line is "- Question: answer". A newer answer to the same question
// replaces the older one; if the notes outgrow the section cap, the oldest
// lines go first.
export function mergeFacts(
  existing: string,
  answers: PlaceholderAnswer[],
): string {
  const incoming = answers.map(lineFor);
  const replaced = new Set(incoming.map(keyOf));
  const kept = existing
    .split("\n")
    .filter((line) => line.startsWith("- ") && line.includes(": "))
    .filter((line) => !replaced.has(keyOf(line)));
  const lines = [...kept, ...incoming];
  while (lines.join("\n").length > PROSE_MAX_CHARS && lines.length > 1) {
    lines.shift();
  }
  return lines.join("\n");
}

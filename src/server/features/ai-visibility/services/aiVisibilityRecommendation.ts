import { sort } from "remeda";

/**
 * Explicit-recommendation detector for one brand in one answer's prose.
 *
 * Returns true or false only when the answer states a verdict about the brand
 * in the same sentence as one of a few explicit phrasings, and null otherwise.
 * Null is the common outcome and means "no explicit verdict found", never "not
 * recommended": a brand listed among options without such language stays null.
 * A rate built from non-null rows is therefore the share of explicit verdicts
 * that were positive, not the share of answers that recommend the brand.
 *
 * Recognized phrasings (all case-insensitive, one sentence):
 *  - verb first: "I/we (would|'d) (highly) recommend|suggest (using) <brand>"
 *    positive, and "I would not recommend <brand>" / "recommend against
 *    <brand>" negative. The brand must follow within 80 characters with no
 *    "over", "instead of", "rather than", "than", "vs", "unlike", "but" or
 *    "not" between, so "I recommend A over B" does not credit B.
 *  - subject first: "<brand> is (highly) recommended", "<brand> is the best
 *    choice|option|pick", "<brand> is a top pick|choice|recommendation"
 *    positive, and "<brand> is not recommended" negative. The phrase must follow
 *    the brand directly, so "A, B and C are the best choice" credits only C.
 * When one brand's mentions get opposite verdicts the result is null.
 */

const VERB_POSITIVE =
  /\b(?:i|we)(?:'d|\s+would)?\s+(?:(?:highly|strongly|definitely|also)\s+)?(?:recommend|suggest)(?:\s+(?:using|trying|going\s+with|choosing))?\b/gi;
const VERB_NEGATIVE =
  /\b(?:(?:i|we)\s+)?(?:(?:would\s+not|wouldn't|do\s+not|don't|cannot|can't|never)\s+(?:really\s+|generally\s+)?recommend(?:ing)?|(?:advise|recommend|caution)\s+against|steer\s+clear\s+of)\b/gi;
const SUBJECT_PREFIX = String.raw`^\s*(?:\([^)]{0,40}\)\s*)?`;
// Group 1 is the verdict wording itself and always runs to the match's end.
const SUBJECT_POSITIVE = new RegExp(
  `${SUBJECT_PREFIX}((?:is|are|remains|would\\s+be)\\s+(?:(?:also|highly|strongly|definitely|generally)\\s+)?(?:(?:the|my|our|a)\\s+)?(?:best\\s+(?:choice|option|pick)|top\\s+(?:pick|choice|recommendation)|recommended))\\b`,
  "i",
);
const SUBJECT_NEGATIVE = new RegExp(
  `${SUBJECT_PREFIX}((?:(?:is|are)\\s+(?:not|never)|isn't|aren't)\\s+(?:(?:really|generally|highly|strongly)\\s+)?recommended)\\b`,
  "i",
);
// Words that move a verdict onto a different brand or negate it.
const VERDICT_BREAKER =
  /\b(?:over|instead\s+of|rather\s+than|than|versus|vs|unlike|but|not|except)\b/i;
const MAX_CUE_DISTANCE = 80;

interface Span {
  start: number;
  end: number;
}

function sentenceBounds(text: string, index: number): Span {
  let start = index;
  while (start > 0 && !/[.!?\n]/.test(text[start - 1])) start--;
  let end = index;
  while (end < text.length && !/[.!?\n]/.test(text[end])) end++;
  return { start, end };
}

interface VerdictPhrase extends Span {
  verdict: boolean;
}

function lastCue(before: string): VerdictPhrase | null {
  const cues = [
    ...[...before.matchAll(VERB_POSITIVE)].map((m) => ({
      verdict: true,
      start: m.index,
      end: m.index + m[0].length,
    })),
    ...[...before.matchAll(VERB_NEGATIVE)].map((m) => ({
      verdict: false,
      start: m.index,
      end: m.index + m[0].length,
    })),
  ];
  return sort(cues, (a, b) => b.end - a.end)[0] ?? null;
}

/** The verdict wording that applies to one mention, as offsets in `text`. */
function verdictForMention(text: string, span: Span): VerdictPhrase | null {
  const sentence = sentenceBounds(text, span.start);
  const before = text.slice(sentence.start, span.start);
  const after = text.slice(span.end, sentence.end);
  for (const [pattern, verdict] of [
    [SUBJECT_NEGATIVE, false],
    [SUBJECT_POSITIVE, true],
  ] as const) {
    const match = pattern.exec(after);
    if (match)
      return {
        verdict,
        start: span.end + match[0].length - match[1].length,
        end: span.end + match[0].length,
      };
  }
  const cue = lastCue(before);
  if (!cue) return null;
  const gap = before.slice(cue.end);
  if (gap.length > MAX_CUE_DISTANCE || VERDICT_BREAKER.test(gap)) return null;
  return {
    verdict: cue.verdict,
    start: sentence.start + cue.start,
    end: sentence.start + cue.end,
  };
}

/**
 * The verdict and every phrase that produced one, in text order. Phrases with
 * opposite verdicts are all returned even though the verdict is then null.
 * `spans` are the brand's mention offsets in `answerText`.
 */
export function recommendationEvidence(answerText: string, spans: Span[]) {
  const phrases = new Map<string, VerdictPhrase>();
  for (const span of spans) {
    const phrase = verdictForMention(answerText, span);
    if (phrase) phrases.set(`${phrase.start}:${phrase.end}`, phrase);
  }
  const verdicts = new Set([...phrases.values()].map((p) => p.verdict));
  return {
    verdict: verdicts.size === 1 ? [...verdicts][0] : null,
    phrases: sort([...phrases.values()], (a, b) => a.start - b.start),
  };
}

export function detectRecommendation(
  answerText: string,
  spans: Span[],
): boolean | null {
  return recommendationEvidence(answerText, spans).verdict;
}

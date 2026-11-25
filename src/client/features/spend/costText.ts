export const INCLUDED_NOTE =
  "This runs a paid lookup that is included in your plan.";
const LIMIT_NOTE = "This would pass this project's usage limit.";
const UNAVAILABLE_NOTE = "This lookup is not available for this workspace.";

const PRICED_TEXT = /\$\d|dataforseo|openrouter|provider/i;

/** Server refusal text, with any price or provider name swapped for plain wording. */
export function plainReason(
  reason: string | null | undefined,
  showCosts: boolean,
): string {
  if (!reason) return "";
  if (showCosts || !PRICED_TEXT.test(reason)) return reason;
  return /limit/i.test(reason) ? LIMIT_NOTE : UNAVAILABLE_NOTE;
}

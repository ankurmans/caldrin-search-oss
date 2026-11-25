export const FAN_OUT_LOOKUP_LIMIT = 25;

export function canLookUpFanOutTerm(term: string) {
  return term.length > 0 && term.length <= 80 && term.split(/\s+/).length <= 10;
}

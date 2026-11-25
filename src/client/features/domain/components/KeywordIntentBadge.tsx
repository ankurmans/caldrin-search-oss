const INTENT_LABELS: Record<string, string> = {
  informational: "Informational",
  navigational: "Navigational",
  commercial: "Commercial",
  transactional: "Transactional",
};

export function intentLabel(intent: string | null) {
  return intent ? (INTENT_LABELS[intent] ?? intent) : "-";
}

export function KeywordIntentBadge({ intent }: { intent: string | null }) {
  if (!intent) return <span className="text-muted-foreground">-</span>;
  return (
    <span
      className="inline-flex rounded border border-border px-1.5 py-0.5 text-xs"
      title={intentLabel(intent)}
    >
      {intentLabel(intent)}
    </span>
  );
}

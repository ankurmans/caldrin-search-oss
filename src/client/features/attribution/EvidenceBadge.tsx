import { Badge } from "@/client/components/ui/badge";
import {
  EVIDENCE_EXPLANATIONS,
  EVIDENCE_LABELS,
  type Evidence,
} from "@/shared/attribution/vocabulary";
import { EVIDENCE_BADGE } from "./format";

/** The label for how a credit is known; its meaning is in the tooltip. */
export function EvidenceBadge({ evidence }: { evidence: Evidence }) {
  return (
    <Badge
      variant={EVIDENCE_BADGE[evidence]}
      title={EVIDENCE_EXPLANATIONS[evidence]}
    >
      {EVIDENCE_LABELS[evidence]}
    </Badge>
  );
}

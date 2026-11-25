import { normalizeCallRecords } from "@/shared/attribution/callTrackingAdapter";
import { normalizeCrmRecords } from "@/shared/attribution/crmAdapter";
import { ingestServerEvents } from "./attributionApiIngest";

const slug = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "source";

/**
 * Maps CRM or call-tracker records to ledger events and, unless it is a dry
 * run, adds them. Ids come from the source system's own record ids, so
 * sending the same export again adds nothing.
 */
export async function importAdapterRecords(
  projectId: string,
  input: {
    kind: "crm" | "calls";
    system: string;
    records: unknown[];
    dryRun: boolean;
  },
) {
  const system = slug(input.system);
  const mapped =
    input.kind === "crm"
      ? normalizeCrmRecords(system, input.records)
      : normalizeCallRecords(system, input.records);
  const base = {
    records: input.records.length,
    events: mapped.events.length,
    skipped: mapped.skipped,
    errors: mapped.errors.slice(0, 50),
  };
  if (input.dryRun || mapped.events.length === 0)
    return { ...base, imported: null };
  const result = await ingestServerEvents(projectId, mapped.events, {
    sourceSystem: `${input.kind}:${system}`,
    label: `${input.kind === "crm" ? "CRM" : "Call tracking"}: ${input.system}`,
  });
  return {
    ...base,
    imported: {
      accepted: result.accepted,
      duplicate: result.duplicate,
      rejected: result.rejected,
      rejections: result.rejections.slice(0, 20),
    },
  };
}

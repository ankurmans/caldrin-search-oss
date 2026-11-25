import {
  CSV_MAX_BYTES,
  parseAttributionCsv,
} from "@/shared/attribution/csvImport";
import { sha256Hex } from "@/server/lib/audit/ids";
import { ingestServerEvents } from "./attributionApiIngest";

const slug = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "file";

/**
 * Reads a CSV of outcomes and, unless it is a dry run, adds them to the ledger.
 * Rows without an id are identified by their content, so importing the same
 * file again under the same name skips every row it already holds.
 */
export async function importAttributionCsv(
  projectId: string,
  input: { text: string; label: string; dryRun: boolean },
) {
  if (input.text.length > CSV_MAX_BYTES)
    return {
      rowCount: 0,
      valid: 0,
      errors: [{ row: 0, message: "The file is larger than 1 MB. Split it." }],
      imported: null,
    };
  const parsed = parseAttributionCsv(input.text);
  const events = await Promise.all(
    parsed.events.map(async (e) => ({
      ...e,
      event_id:
        e.event_id ??
        `row:${(await sha256Hex(JSON.stringify(e))).slice(0, 20)}`,
    })),
  );
  const base = {
    rowCount: parsed.rowCount,
    valid: events.length,
    errors: parsed.errors.slice(0, 50),
  };
  if (input.dryRun || events.length === 0) return { ...base, imported: null };
  const result = await ingestServerEvents(projectId, events, {
    sourceSystem: `csv:${slug(input.label)}`,
    label: `CSV: ${input.label}`,
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

import type { AuditRow } from "../repositories/AuditLogRepository";

const COLUMNS = [
  "time_utc",
  "actor_kind",
  "actor",
  "client",
  "action",
  "what",
  "project_id",
  "target",
  "outcome",
] as const;

// A cell a spreadsheet would read as a formula gets a leading quote, so a
// summary an attacker influenced cannot run in the exporter's spreadsheet.
function cell(value: string | null) {
  let text = value ?? "";
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: AuditRow[]) {
  const lines = rows.map((row) =>
    [
      row.createdAt,
      row.actorKind,
      row.actorLabel,
      row.actorClient,
      row.action,
      row.summary,
      row.projectId,
      [row.targetKind, row.targetId].filter(Boolean).join(":"),
      row.outcome,
    ]
      .map(cell)
      .join(","),
  );
  return [COLUMNS.join(","), ...lines].join("\n");
}

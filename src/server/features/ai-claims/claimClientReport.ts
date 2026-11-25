import { escapeHtml } from "@/server/features/content/rules/sanitizeHtml";
import { ReportService } from "@/server/features/reports/services/ReportService";
import { AppError } from "@/server/lib/errors";
import { claimCorrectionRepository } from "./claimCorrectionRepository";
import { requireCorrectionReviewer } from "./claimCorrections";
import type { ClaimActor } from "./claimJobs";

const descriptions = {
  matches_fact: "The answer matched the approved fact",
  conflict_persists: "The answer still conflicted with the approved fact",
  not_found_in_extraction:
    "The extracted claims did not include the reviewed claim",
  inconclusive: "The answer did not support a conclusion",
} as const;

export async function createClaimClientReport(actor: ClaimActor, id: string) {
  await requireCorrectionReviewer(actor);
  const correction = await claimCorrectionRepository.get(actor.projectId, id);
  if (!correction) throw new AppError("NOT_FOUND", "Correction unavailable.");

  const [entries, readings] = await Promise.all([
    claimCorrectionRepository.relatedLedger(correction),
    claimCorrectionRepository.history(correction.id),
  ]);
  const publication = entries.find(
    (entry) =>
      entry.status === "executed" &&
      entry.publicationStatus === "published" &&
      entry.executedAt &&
      entry.targetUrl === correction.targetUrl,
  );
  if (!publication?.executedAt)
    throw new AppError(
      "VALIDATION_ERROR",
      "Verify the published correction first.",
    );

  const followups = readings.filter(
    (reading) => reading.ledgerId === publication.id,
  );
  const date = escapeHtml(publication.executedAt.slice(0, 10));
  const summary =
    "Verified publication and recorded AI answer follow-ups for one reviewed correction.";
  const list = followups
    .map(
      (row) =>
        `<li>${escapeHtml(row.createdAt.slice(0, 10))} · ${descriptions[row.outcome]}</li>`,
    )
    .join("");
  const kind = correction.kind === "owned" ? "Owned page" : "Third-party page";
  return ReportService.saveReport({
    projectId: actor.projectId,
    organizationId: actor.organizationId,
    title: `Claim correction report · ${date} · ${crypto.randomUUID().slice(0, 8)}`,
    summary,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Claim correction report</title>
<style>body{font:16px system-ui;margin:2rem auto;padding:0 1rem;max-width:46rem;color:#171713;line-height:1.55}dd{margin:0 0 .75rem;overflow-wrap:anywhere}dt{font-weight:600}li{margin:.4rem 0}</style></head><body>
<h1>Claim correction report</h1><p>A reviewer confirmed a conflict with an approved fact. The revised passage was subsequently verified on the public page.</p>
<h2>Verified publication</h2><dl><dt>Page type</dt><dd>${kind}</dd><dt>Public page</dt><dd>${escapeHtml(correction.targetUrl)}</dd><dt>Verified on (UTC)</dt><dd>${date}</dd></dl>
<h2>AI answer follow-ups</h2><p>${followups.length ? `This report includes ${followups.length} comparable ${followups.length === 1 ? "answer" : "answers"}.` : "No comparable follow-up answers have been recorded."}</p>
${list ? `<ul>${list}</ul>` : ""}<p>These observations cover the answers reviewed. They do not establish what caused any difference or how future answers will respond.</p>
</body></html>`,
    createdBy: "app",
    createdByUserId: actor.userId,
  });
}

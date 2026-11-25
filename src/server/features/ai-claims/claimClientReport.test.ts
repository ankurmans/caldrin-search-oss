import { z } from "zod";
import { beforeEach, expect, it, vi } from "vitest";
import { AppError } from "@/server/lib/errors";
import { createClaimClientReport } from "./claimClientReport";

const mocks = vi.hoisted(() => ({
  review: vi.fn(),
  get: vi.fn(),
  ledger: vi.fn(),
  readings: vi.fn(),
  save: vi.fn(),
}));

vi.mock("./claimCorrections", () => ({
  requireCorrectionReviewer: mocks.review,
}));
vi.mock("./claimCorrectionRepository", () => ({
  claimCorrectionRepository: {
    get: mocks.get,
    relatedLedger: mocks.ledger,
    history: mocks.readings,
  },
}));
vi.mock("@/server/features/reports/services/ReportService", () => ({
  ReportService: { saveReport: mocks.save },
}));

const owner = {
  projectId: "project",
  organizationId: "org",
  userId: "owner",
  role: "owner",
};
const url = "https://example.com/guide/<img>";

beforeEach(() => {
  mocks.review.mockResolvedValue(undefined);
  mocks.get.mockResolvedValue({
    id: "correction",
    kind: "owned",
    targetUrl: url,
    outreachDraft: "private outreach copy",
  });
  mocks.ledger.mockResolvedValue([
    {
      id: "published",
      status: "executed",
      publicationStatus: "published",
      executedAt: "2026-11-23T15:00:00Z",
      targetUrl: url,
      beforeState: "private raw snapshot",
    },
  ]);
  mocks.readings.mockResolvedValue([
    { ledgerId: "published", createdAt: "2026-11-23", outcome: "matches_fact" },
    {
      ledgerId: "superseded",
      createdAt: "2026-11-23",
      outcome: "conflict_persists",
    },
  ]);
  mocks.save.mockResolvedValue({ reportId: "report" });
});

it("saves a project-scoped, client-safe snapshot of one verified publication", async () => {
  expect(await createClaimClientReport(owner, "correction")).toEqual({
    reportId: "report",
  });
  expect(mocks.get).toHaveBeenCalledWith("project", "correction");
  const report = z
    .looseObject({ html: z.string() })
    .parse(mocks.save.mock.calls[0]?.[0]);
  expect(report).toMatchObject({
    projectId: "project",
    organizationId: "org",
    createdByUserId: "owner",
  });
  expect(report.html).toContain("This report includes 1 comparable answer.");
  expect(report.html).toContain("matched the approved fact");
  expect(report.html).toContain("&lt;img&gt;");
  expect(report.html).not.toMatch(
    /<img>|private raw|private outreach|still conflicted/,
  );
  expect(report).not.toHaveProperty("visible");
});

it("refuses creation before the publication is verified", async () => {
  mocks.ledger.mockResolvedValueOnce([{ status: "approved" }]);
  await expect(
    createClaimClientReport(owner, "correction"),
  ).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
  expect(mocks.save).not.toHaveBeenCalled();
});

it("leaves client access to the read-only published report path", async () => {
  mocks.review.mockRejectedValueOnce(new AppError("FORBIDDEN"));
  await expect(
    createClaimClientReport({ ...owner, role: "scoped" }, "correction"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});

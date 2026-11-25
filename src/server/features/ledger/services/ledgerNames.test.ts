import { beforeEach, describe, expect, it, vi } from "vitest";
import { LedgerService } from "./LedgerService";
import {
  approved,
  executed,
  propose,
  resetDatabase,
  scopeA,
  seedMember,
} from "./ledgerTestSupport";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => (await import("./ledgerDb")).ledgerDbMock());

beforeEach(resetDatabase);

describe("people names", () => {
  it("shows the member's name, then the email's local part, then Unknown user", async () => {
    seedMember("org-1", "user-1", "Ada Lovelace", "ada@example.com");
    const entry = await approved();
    const detail = await LedgerService.getEntryWithNames("project-a", entry.id);
    expect(detail.entry).toMatchObject({
      proposedByName: "Ada Lovelace",
      approvedByName: "Ada Lovelace",
      executedByName: null,
      rolledBackByName: null,
      finalDecidedByName: null,
    });

    resetDatabase();
    seedMember("org-1", "user-1", "  ", "ada.l@example.com");
    const noName = await approved();
    const [listed] = await LedgerService.listEntriesWithNames("project-a");
    expect(listed.id).toBe(noName.id);
    expect(listed.proposedByName).toBe("ada.l");

    resetDatabase();
    const stranger = await executed();
    const later = await LedgerService.getEntryWithNames(
      "project-a",
      stranger.id,
    );
    expect(later.entry).toMatchObject({
      proposedByName: "Unknown user",
      approvedByName: "Unknown user",
      executedByName: "Unknown user",
    });
  });

  it("does not leak the name of a user who belongs to another organization", async () => {
    // user-1 is a member of org-2 only; the entry belongs to org-1.
    seedMember("org-2", "user-1", "Grace Hopper", "grace@other.example");
    const entry = await propose();
    expect(entry.organizationId).toBe(scopeA.organizationId);
    const detail = await LedgerService.getEntryWithNames("project-a", entry.id);
    expect(detail.entry.proposedByName).toBe("Unknown user");
    const [listed] = await LedgerService.listEntriesWithNames("project-a");
    expect(listed.proposedByName).toBe("Unknown user");
  });

  it("names the rejecter of a rejected entry", async () => {
    seedMember("org-1", "user-1", "Ada Lovelace", "ada@example.com");
    const entry = await propose();
    await LedgerService.rejectChange(scopeA, entry.id, "Wrong page");
    const detail = await LedgerService.getEntryWithNames("project-a", entry.id);
    expect(detail.entry).toMatchObject({
      status: "rejected",
      finalDecision: "Rejected: Wrong page",
      finalDecidedByName: "Ada Lovelace",
    });
  });
});

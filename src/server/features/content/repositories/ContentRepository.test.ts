import { beforeEach, describe, expect, it, vi } from "vitest";
import { contentDbMock, resetDatabase } from "../services/contentTestDb";
import { ContentRepository } from "./ContentRepository";

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => contentDbMock());

beforeEach(resetDatabase);

const asset = (projectId: string) => ({
  projectId,
  organizationId: "org-1",
  opportunityId: null,
  title: "Best beans",
  searchIntent: "x",
  briefMarkdown: "x",
  bodyHtml: "<p>body</p>",
  metaTitle: "Best beans",
  metaDescription: "A description",
  generator: "template" as const,
  createdByUserId: "user-1",
  references: [],
});

const edit = {
  title: "Best beans v2",
  bodyHtml: "<p>new</p>",
  metaTitle: "m",
  metaDescription: "d",
};

describe("content repository isolation and approval", () => {
  it("never returns, edits or approves another project's draft", async () => {
    const created = await ContentRepository.createAsset(asset("project-a"));
    expect(
      await ContentRepository.getAsset("project-b", created.id),
    ).toBeNull();
    expect(
      await ContentRepository.updateAssetContent(
        "project-b",
        created.id,
        "user-2",
        edit,
      ),
    ).toBeNull();
    expect(
      await ContentRepository.approveAsset(
        "project-b",
        created.id,
        1,
        "user-2",
      ),
    ).toBe(false);
    expect(await ContentRepository.listAssets("project-b")).toEqual([]);
  });

  it("drops the approval when the text changes and keeps every version", async () => {
    const created = await ContentRepository.createAsset(asset("project-a"));
    expect(
      await ContentRepository.approveAsset(
        "project-a",
        created.id,
        1,
        "user-1",
      ),
    ).toBe(true);
    const updated = await ContentRepository.updateAssetContent(
      "project-a",
      created.id,
      "user-1",
      edit,
    );
    expect(updated).toMatchObject({
      revision: 2,
      status: "draft",
      approvedRevision: null,
    });
    const versions = await ContentRepository.listVersions(created.id);
    expect(versions.map((v) => v.revision)).toEqual([2, 1]);
  });

  it("refuses to approve a revision that is no longer current", async () => {
    const created = await ContentRepository.createAsset(asset("project-a"));
    await ContentRepository.updateAssetContent(
      "project-a",
      created.id,
      "u",
      edit,
    );
    expect(
      await ContentRepository.approveAsset("project-a", created.id, 1, "u"),
    ).toBe(false);
  });

  it("keeps an imported baseline when a stale working copy tries to save", async () => {
    const created = await ContentRepository.createAsset({
      ...asset("project-a"),
      importedFrom: "https://example.com/post",
    });
    expect(
      await ContentRepository.updateAssetContent(
        "project-a",
        created.id,
        "user-1",
        edit,
        1,
      ),
    ).toMatchObject({ revision: 2 });
    expect(
      await ContentRepository.updateAssetContent(
        "project-a",
        created.id,
        "user-2",
        { ...edit, title: "Stale" },
        1,
      ),
    ).toBeNull();
    expect(
      await ContentRepository.getAsset("project-a", created.id),
    ).toMatchObject({
      importedFrom: "https://example.com/post",
      title: edit.title,
    });
    expect(await ContentRepository.listVersions(created.id)).toMatchObject([
      { revision: 2, bodyHtml: edit.bodyHtml },
      { revision: 1, bodyHtml: created.bodyHtml },
    ]);
  });

  it("lets only one request claim a publication key", async () => {
    const created = await ContentRepository.createAsset(asset("project-a"));
    const claim = {
      assetId: created.id,
      revision: 1,
      mode: "live" as const,
      idempotencyKey: "shopify:a:r1:create_draft",
      requestedByUserId: "user-1",
    };
    expect(await ContentRepository.claimPublication(claim)).not.toBeNull();
    expect(await ContentRepository.claimPublication(claim)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { buildCsv } from "@/client/lib/csv";
import type { BacklinksRow, ReferringDomainRow } from "./backlinksPageTypes";
import { buildBacklinksTabFilename, buildBacklinksTabExport } from "./export";

function makeBacklinkRow(overrides: Partial<BacklinksRow> = {}): BacklinksRow {
  return {
    domainFrom: "example.org",
    urlFrom: "https://example.org/post",
    urlTo: "https://example.com/path",
    anchor: "Example",
    itemType: "organic",
    isDofollow: true,
    relAttributes: ["noopener", "noreferrer"],
    rank: 123,
    domainFromRank: 45,
    pageFromRank: 12,
    spamScore: 10,
    firstSeen: "2025-01-01",
    lastSeen: "2025-01-15",
    isLost: false,
    isBroken: false,
    linksCount: 2,
    lostDate: null,
    prevSeen: null,
    isNew: null,
    pageTitle: null,
    pageLanguage: null,
    pageStatusCode: null,
    platformTypes: [],
    domainCountry: null,
    textBefore: null,
    textAfter: null,
    semanticLocation: null,
    targetStatusCode: null,
    targetRedirect: null,
    ...overrides,
  };
}

function makeReferringDomainRow(
  overrides: Partial<ReferringDomainRow> = {},
): ReferringDomainRow {
  return {
    domain: "source.com",
    backlinks: 12,
    referringPages: 7,
    rank: 101,
    spamScore: 4,
    firstSeen: "2024-05-10",
    brokenBacklinks: 1,
    brokenPages: 0,
    ...overrides,
  };
}

function buildTabCsv(
  ...args: Parameters<typeof buildBacklinksTabExport>
): string {
  const { headers, rows } = buildBacklinksTabExport(...args);
  return buildCsv(headers, rows);
}

describe("buildBacklinksTabFilename", () => {
  it("normalizes the target into the filename per tab", () => {
    expect(
      buildBacklinksTabFilename("backlinks", "https://Example.com/path?q=1"),
    ).toBe("backlinks-backlinks-example.com-path-q-1");
    expect(buildBacklinksTabFilename("domains", "Example.com")).toBe(
      "backlinks-referring-domains-example.com",
    );
    expect(buildBacklinksTabFilename("pages", "docs.example.com")).toBe(
      "backlinks-top-pages-docs.example.com",
    );
  });
});

describe("buildBacklinksTabExport", () => {
  it("builds backlinks csv with backlink-specific columns", () => {
    const content = buildTabCsv({
      tab: "backlinks",
      rows: {
        backlinks: [makeBacklinkRow()],
        referringDomains: [],
        topPages: [],
      },
    });

    expect(content).toContain('"Domain","Source URL","Target URL"');
    expect(content).toContain('"example.org"');
    expect(content).toContain('"noopener, noreferrer"');
  });

  it("builds referring domains csv", () => {
    const content = buildTabCsv({
      tab: "domains",
      rows: {
        backlinks: [],
        referringDomains: [makeReferringDomainRow()],
        topPages: [],
      },
    });

    expect(content).toContain('"Domain","Backlinks","Referring Pages"');
    expect(content).toContain('"source.com"');
  });

  it("builds top pages csv", () => {
    const content = buildTabCsv({
      tab: "pages",
      rows: {
        backlinks: [],
        referringDomains: [],
        topPages: [
          {
            page: "https://docs.example.com/start",
            backlinks: 22,
            referringDomains: 9,
            rank: 88,
            brokenBacklinks: 0,
          },
        ],
      },
    });

    expect(content).toContain(
      '"Page","Backlinks","Referring Domains","Rank","Broken Backlinks"',
    );
    expect(content).toContain('"https://docs.example.com/start"');
  });
});

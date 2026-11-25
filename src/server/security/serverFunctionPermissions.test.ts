import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Read/write separation, checked statically. Reads need project access only
// (requireProjectContext already enforces it). Anything that is not a read
// must call requireOrgPermission, or be listed here with the reason it is
// allowed not to.
const FILES = ["content", "ledger", "opportunities", "spend"];

// A handler is a read when its name says so AND its body calls nothing that
// writes. Most handlers here are POST (they take a projectId), so the HTTP
// method cannot tell reads from writes.
const READ_NAME = /^(get|list|read|estimate|preview)[A-Z]/;
const WRITING_CALL =
  /\.(set|create|insert|update|delete|remove|record|approve|reject|propose|publish|save|upsert|connect|disconnect|extract|run|collect|execute|begin|rollback)\w*\(/;

// Write handlers deliberately open to any project member. Key: "file:name".
const ALLOWED_WITHOUT_PERMISSION: Record<string, string> = {};

// FINDINGS: write handlers that skip the gate today. Listing them keeps the
// test green while the gap is open, and the test below fails the moment one is
// fixed so the entry gets deleted rather than rotting.
const KNOWN_GAPS: Record<string, string> = {};

type Handler = { key: string; name: string; text: string };

// A path can be a file or, as opportunities currently is, a directory that
// holds a file of the same name.
function sourceOf(file: string): string | null {
  const path = `src/serverFunctions/${file}.ts`;
  if (!existsSync(path)) return null;
  return readFileSync(
    statSync(path).isDirectory() ? `${path}/${file}.ts` : path,
    "utf8",
  );
}

function handlersIn(file: string): Handler[] {
  const source = sourceOf(file);
  if (!source) return [];
  const parts = source.split(/^export const (\w+) = createServerFn\(/m);
  const handlers: Handler[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    handlers.push({
      key: `${file}:${parts[i]}`,
      name: parts[i] ?? "",
      text: parts[i + 1] ?? "",
    });
  }
  return handlers;
}

const all = FILES.flatMap(handlersIn);
const isRead = (h: Handler) =>
  READ_NAME.test(h.name) && !WRITING_CALL.test(h.text);
const gated = (h: Handler) => h.text.includes("requireOrgPermission(");
const writes = all.filter((h) => !isRead(h));

describe("server function read/write separation", () => {
  it("finds the handlers it is meant to check", () => {
    const names = all.map((h) => h.key);
    expect(names).toContain("content:approveContentDraft");
    expect(names).toContain("spend:setSpendLimits");
  });

  it("gates every write handler with requireOrgPermission unless it is allow-listed", () => {
    const ungated = writes
      .filter((h) => !gated(h))
      .map((h) => h.key)
      .filter((key) => !(key in ALLOWED_WITHOUT_PERMISSION))
      .filter((key) => !(key in KNOWN_GAPS));
    expect(ungated).toEqual([]);
  });

  it("does not let a read handler hide a write behind a get/list name", () => {
    const disguised = all
      .filter((h) => READ_NAME.test(h.name) && WRITING_CALL.test(h.text))
      .filter((h) => !gated(h))
      .map((h) => h.key)
      .filter(
        (key) => !(key in KNOWN_GAPS) && !(key in ALLOWED_WITHOUT_PERMISSION),
      );
    expect(disguised).toEqual([]);
  });

  it("keeps the allow-lists honest: no entry for a handler that is gone, gated, or a read", () => {
    const byKey = new Map(all.map((h) => [h.key, h]));
    const stale = [
      ...Object.keys(ALLOWED_WITHOUT_PERMISSION),
      ...Object.keys(KNOWN_GAPS),
    ].filter((key) => {
      const handler = byKey.get(key);
      // A file that does not exist yet cannot make its entries stale.
      if (!handler) return sourceOf(key.split(":")[0] ?? "") !== null;
      return isRead(handler) || gated(handler);
    });
    expect(stale).toEqual([]);
  });
});

// Draft-only by default: approval and publishing are a person's action in the
// app, so no MCP tool in the content/ledger/opportunity/spend area may approve,
// publish, execute or roll back anything.
describe("MCP tools stay draft-only", () => {
  const dir = "src/server/mcp/tools";
  const files = readdirSync(dir).filter(
    (name) =>
      /(content|ledger|opportunit|spend)/.test(name) &&
      name.endsWith(".ts") &&
      !name.endsWith(".test.ts"),
  );

  it("finds the tool files it is meant to check", () => {
    expect(files).toContain("content-tools.ts");
  });

  it.each(files)("%s registers no approving or publishing tool", (file) => {
    const source = readFileSync(`${dir}/${file}`, "utf8");
    const toolNames = [...source.matchAll(/^\s*name: "([a-z_]+)"/gm)].map(
      (match) => match[1] ?? "",
    );
    expect(
      toolNames.filter((n) => /approve|publish|execut|rollback/.test(n)),
    ).toEqual([]);
    expect(source).not.toMatch(
      /\.(approve|publish|beginExecution|recordExecution|beginRollback|rollback)\w*\(/,
    );
  });
});

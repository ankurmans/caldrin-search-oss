import { expect, it, vi } from "vitest";
import { registerCaldrinSearchTools } from "@/server/mcp/server";

vi.mock("cloudflare:workers", () => ({ env: {} }));

it("gives agents no way to approve, publish, execute or roll back content", () => {
  const names: string[] = [];
  registerCaldrinSearchTools((tool) => {
    names.push(tool.name);
  });
  const contentTools = names.filter((name) => name.includes("content"));
  expect(contentTools).toContain("create_content_draft");
  expect(
    names.filter((name) =>
      /approve|publish_|shopify|rollback|execute|ledger/.test(name),
    ),
  ).toEqual([]);
});

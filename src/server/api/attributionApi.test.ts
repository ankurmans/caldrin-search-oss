import { Script } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRACKER_SCRIPT } from "@/shared/attribution/tracker";
import { handleAttributionCollect } from "./attributionCollect";
import { handleAttributionEvents } from "./attributionEvents";
import { AttributionLedgerRepository as ledger } from "@/server/features/attribution/repositories/AttributionLedgerRepository";
import { rotateAttributionKey } from "@/server/features/attribution/services/attributionKeys";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("../features/ai-visibility/aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));

const post = (
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(`https://search.test${url}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("attribution HTTP endpoints", () => {
  beforeEach(async () => {
    await testDb.seedProject();
    await ledger.insertProperty({
      id: "prop",
      projectId: "project",
      name: "Site",
      host: "example.com",
      createdAt: new Date().toISOString(),
    });
  });

  it("takes browser events with a public key as text/plain and answers CORS preflights", async () => {
    const { key } = await rotateAttributionKey("project", "public");
    const body = {
      k: key,
      events: [
        {
          id: "e1",
          type: "session_start",
          t: Date.now(),
          vid: "v1",
          url: "https://example.com/?utm_source=x",
        },
      ],
    };

    const response = await handleAttributionCollect(
      post("/api/attribution/collect", body, { "content-type": "text/plain" }),
    );
    const preflight = await handleAttributionCollect(
      new Request("https://search.test/api/attribution/collect", {
        method: "OPTIONS",
      }),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 1, rejected: 0 });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.status).toBe(204);
  });

  it("refuses a public key on the backend endpoint and a secret key in the browser", async () => {
    const { key: pub } = await rotateAttributionKey("project", "public");
    const { key: secret } = await rotateAttributionKey("project", "secret");
    const event = { events: [{ type: "signup", user_id: "u1" }] };

    const withPublic = await handleAttributionEvents(
      post("/api/attribution/events", event, {
        authorization: `Bearer ${pub}`,
      }),
    );
    const secretInBrowser = await handleAttributionCollect(
      post("/api/attribution/collect", {
        k: secret,
        events: [
          { id: "x", type: "page_view", vid: "v", url: "https://example.com/" },
        ],
      }),
    );

    expect(withPublic.status).toBe(401);
    expect(secretInBrowser.status).toBe(401);
  });

  it("stores a backend event once however many times it is delivered", async () => {
    const { key } = await rotateAttributionKey("project", "secret");
    const send = () =>
      handleAttributionEvents(
        post(
          "/api/attribution/events",
          { events: [{ event_id: "same", type: "signup", user_id: "u1" }] },
          { authorization: `Bearer ${key}` },
        ),
      );

    const first = await (await send()).json();
    const second = await (await send()).json();

    expect(first).toMatchObject({ accepted: 1, duplicate: 0 });
    expect(second).toMatchObject({ accepted: 0, duplicate: 1 });
  });

  it("serves a tracker that parses as JavaScript", () => {
    expect(() => new Script(TRACKER_SCRIPT)).not.toThrow();
  });
});

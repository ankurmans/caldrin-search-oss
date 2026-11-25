import { expect, it, vi } from "vitest";
import { dataforseoBasicToken } from "./key-check";

vi.mock("cloudflare:workers", () => ({ env: {} }));

it("joins the DataForSEO login and API password into the Basic token", () => {
  expect(dataforseoBasicToken("me@example.com", "pässword")).toBe(
    btoa(
      String.fromCharCode(
        ...new TextEncoder().encode("me@example.com:pässword"),
      ),
    ),
  );
});

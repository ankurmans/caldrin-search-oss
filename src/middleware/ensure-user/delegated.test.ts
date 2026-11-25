import { describe, expect, it, vi } from "vitest";
import { isLoopbackHost } from "./delegated";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: {} }));

describe("isLoopbackHost", () => {
  it("accepts loopback hosts and refuses everything else", () => {
    expect(isLoopbackHost("127.0.0.1:4334")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("[::1]:8787")).toBe(true);
    expect(isLoopbackHost("app.localhost:3000")).toBe(true);
    expect(isLoopbackHost("search.example.com")).toBe(false);
    expect(isLoopbackHost("localhost.evil.com")).toBe(false);
    expect(isLoopbackHost(null)).toBe(false);
  });
});

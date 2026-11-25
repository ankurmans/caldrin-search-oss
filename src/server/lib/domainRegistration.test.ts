import { beforeEach, expect, it, vi } from "vitest";
import { getDomainRegistrationDate } from "@/server/lib/domainRegistration";

const { connect, answers } = vi.hoisted(() => ({
  connect: vi.fn(),
  answers: new Map<string, string>(),
}));
vi.mock("cloudflare:sockets", () => ({ connect }));

beforeEach(() => {
  answers.clear();
  connect.mockImplementation(({ hostname }: { hostname: string }) => {
    let query = "";
    return {
      writable: {
        getWriter: () => ({
          write: async (bytes: Uint8Array) => {
            query = new TextDecoder().decode(bytes).trim();
          },
          releaseLock: () => {},
        }),
      },
      // Answers only once read, after the query has been written.
      readable: new ReadableStream(
        {
          pull(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                answers.get(`${hostname}/${query}`) ?? "",
              ),
            );
            controller.close();
          },
        },
        { highWaterMark: 0 },
      ),
      close: async () => {},
    };
  });
});

it("reads the registration date from the registry the TLD points to", async () => {
  answers.set("whois.iana.org/co", "refer: whois.registry.co\n");
  answers.set(
    "whois.registry.co/pepys.co",
    "Domain Name: PEPYS.CO\nCreation Date: 2026-06-15T09:45:29.0Z\n",
  );

  expect(await getDomainRegistrationDate("pepys.co")).toBe("2026-06-15");
});

it("returns null when the registry names no creation date", async () => {
  answers.set("whois.iana.org/xx", "refer: whois.example.xx\n");
  answers.set("whois.example.xx/a.xx", "Domain Name: A.XX\n");

  expect(await getDomainRegistrationDate("a.xx")).toBeNull();
});

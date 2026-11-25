import { z } from "zod";

// Test-only: reads the request a client sent to the fake fetch.
const sentSchema = z.object({
  query: z.string(),
  variables: z.record(z.string(), z.unknown()),
});

export type Sent = z.infer<typeof sentSchema>;

export function readSent(init?: RequestInit): Sent {
  const raw: unknown = JSON.parse(
    typeof init?.body === "string" ? init.body : "{}",
  );
  return sentSchema.parse(raw);
}

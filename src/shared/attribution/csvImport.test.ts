import { describe, expect, it } from "vitest";
import { parseAttributionCsv } from "./csvImport";

describe("attribution CSV import", () => {
  it("reads outcomes in whole units and reports the rows it cannot use by number", () => {
    const csv = [
      "Date,Event Type,Amount,Currency,Customer ID,How did you hear",
      "2026-11-03,payment,49.00,USD,c1,A friend",
      "2026-11-04,payment,5000,JPY,c2,",
      "11/05/2026,payment,10,USD,c3,",
      "2026-11-06,payment,10,,c4,",
      "2026-11-07,refund,abc,USD,c5,",
    ].join("\n");

    const parsed = parseAttributionCsv(csv);

    expect(parsed.events.map((e) => [e.amount_minor, e.currency])).toEqual([
      [4900, "USD"],
      [5000, "JPY"],
    ]);
    expect(parsed.events[0]).toMatchObject({
      customer_id: "c1",
      self_reported_source: "A friend",
      occurred_at: "2026-11-03T00:00:00.000Z",
    });
    expect(parsed.errors.map((e) => e.row)).toEqual([4, 5, 6]);
    expect(parsed.errors[0]?.message).toMatch(/ISO date/);
  });

  it("reads call and brand-routing columns", () => {
    const csv = [
      "Date,Type,Lead ID,Brand,Intended Brand,Call Status,Duration",
      "2026-11-03,call,l1,Luma Creative,Westwave AV,answered,95",
      "2026-11-04,call,l2,Luma Creative,,answered,a minute",
    ].join("\n");

    const parsed = parseAttributionCsv(csv);

    expect(parsed.events[0]).toMatchObject({
      intended_brand: "Westwave AV",
      call_status: "answered",
      duration_seconds: 95,
    });
    expect(parsed.errors.map((e) => e.row)).toEqual([3]);
  });
});

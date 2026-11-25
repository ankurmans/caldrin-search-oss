import { describe, expect, it } from "vitest";
import { percentChange, positionChange } from "./FirstPartyShared";

describe("first-party change colours", () => {
  it("marks a rise good and a fall bad, and leaves a tiny move grey", () => {
    expect(percentChange(110, 100)?.tone).toBe("good");
    expect(percentChange(70, 100)?.tone).toBe("bad");
    expect(percentChange(100.5, 100)).toMatchObject({ tone: "flat" });
  });

  it("treats a falling position number as an improvement", () => {
    expect(positionChange(4.8, 6.2)?.tone).toBe("good");
    expect(positionChange(6.2, 4.8)?.tone).toBe("bad");
  });
});

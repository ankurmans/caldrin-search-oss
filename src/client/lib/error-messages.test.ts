import { describe, expect, it } from "vitest";
import { getStandardErrorMessage } from "@/client/lib/error-messages";

describe("getStandardErrorMessage", () => {
  it("maps known error codes to standard copy", () => {
    expect(getStandardErrorMessage(new Error("TRIAL_ENDED"))).toBe(
      "You've used your free test run. Add your own provider keys to keep going, or upgrade to Caldrin Cloud.",
    );
  });

  it("returns custom messages when the error is not a shared code", () => {
    expect(
      getStandardErrorMessage(new Error("Something failed: try again")),
    ).toBe("Something failed: try again");
  });
});

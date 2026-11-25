import { describe, expect, it } from "vitest";
import {
  effectivePrivacyChoices,
  readPrivacyCookie,
  requiresOptIn,
} from "./privacy-choices";

describe("privacy choices", () => {
  it("needs opt-in for EEA/UK/Swiss and unknown locations only", () => {
    expect(requiresOptIn("DE")).toBe(true);
    expect(requiresOptIn("GB")).toBe(true);
    expect(requiresOptIn(null)).toBe(true);
    expect(requiresOptIn("XX")).toBe(true);
    expect(requiresOptIn("T1")).toBe(true);
    expect(requiresOptIn("US")).toBe(false);
  });

  it("keeps analytics off until an opt-in visitor chooses", () => {
    expect(effectivePrivacyChoices({ saved: null, optIn: true })).toEqual({
      analytics: false,
    });
    expect(effectivePrivacyChoices({ saved: null, optIn: false })).toEqual({
      analytics: true,
    });
  });

  it("reads the analytics choice from a current or older cookie", () => {
    expect(readPrivacyCookie("caldrin_search_privacy=a1")).toEqual({
      analytics: true,
    });
    expect(
      readPrivacyCookie("other=1; caldrin_search_privacy=a0.d1.m2"),
    ).toEqual({ analytics: false });
    expect(readPrivacyCookie("caldrin_search_privacy=garbage")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { experimentVerdict } from "./experimentVerdict";

const tally = (recommended: number, answers = 3) => ({
  answers,
  named: answers,
  recommended,
});
const prompt = (control: number, variant: number, stable = true) => ({
  control: tally(control),
  variant: tally(variant),
  controlStable: stable,
});

describe("experimentVerdict", () => {
  it("calls a move only when it is larger than the run-to-run spread", () => {
    const moved = experimentVerdict([prompt(0, 3), prompt(0, 3)], 3);
    expect(moved).toMatchObject({
      call: "moved_up",
      control: { numerator: 0, denominator: 6 },
      variant: { numerator: 6, denominator: 6 },
    });

    const noisy = experimentVerdict(
      [prompt(1, 3, false), prompt(1, 2, false)],
      3,
    );
    expect(noisy.call).toBe("within_noise");
    expect(noisy.noise).toMatchObject({ numerator: 2, denominator: 2 });
  });

  it("makes no call when the spread was not measured", () => {
    expect(experimentVerdict([prompt(0, 3)], 2).call).toBe("too_few_repeats");
  });
});

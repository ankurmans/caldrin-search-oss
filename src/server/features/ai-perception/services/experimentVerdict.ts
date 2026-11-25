import {
  EXPERIMENT_LIMITS,
  type ExperimentArmTally,
  type ExperimentVerdict,
} from "@/shared/ai-perception-experiments";

const rate = (numerator: number, denominator: number) => ({
  numerator,
  denominator,
  rate: denominator ? numerator / denominator : null,
});

const sum = (tallies: ExperimentArmTally[], key: keyof ExperimentArmTally) =>
  tallies.reduce((total, t) => total + t[key], 0);

/** A difference smaller than this many answers' worth is never called a move. */
const MIN_MOVE = 0.2;

/**
 * Compares the edited page with the original on the same prompts. The control
 * repeats show how much identical input varies on its own; a difference inside
 * that spread, or under a fifth of the answers, is reported as noise.
 */
export function experimentVerdict(
  prompts: {
    control: ExperimentArmTally;
    variant: ExperimentArmTally;
    controlStable: boolean;
  }[],
  repeats: number,
): ExperimentVerdict {
  const control = rate(
    sum(
      prompts.map((p) => p.control),
      "recommended",
    ),
    sum(
      prompts.map((p) => p.control),
      "answers",
    ),
  );
  const variant = rate(
    sum(
      prompts.map((p) => p.variant),
      "recommended",
    ),
    sum(
      prompts.map((p) => p.variant),
      "answers",
    ),
  );
  const noise = rate(
    prompts.filter((p) => !p.controlStable).length,
    prompts.length,
  );
  const delta = (variant.rate ?? 0) - (control.rate ?? 0);
  const counts = `${variant.numerator} of ${variant.denominator} edited-page answers recommended the brand, against ${control.numerator} of ${control.denominator} with the original page`;
  const noiseText = `${noise.numerator} of ${noise.denominator} prompts gave different readings for the same original page across repeats`;

  if (repeats < EXPERIMENT_LIMITS.minRepeatsForVerdict || !control.denominator)
    return {
      control,
      variant,
      noise,
      repeats,
      call: "too_few_repeats",
      explanation: `${counts}. With fewer than ${EXPERIMENT_LIMITS.minRepeatsForVerdict} repeats the run-to-run spread is not measured, so no call is made.`,
    };
  const threshold = Math.max(noise.rate ?? 0, MIN_MOVE);
  const call =
    Math.abs(delta) <= threshold
      ? "within_noise"
      : delta > 0
        ? "moved_up"
        : "moved_down";
  return {
    control,
    variant,
    noise,
    repeats,
    call,
    explanation: `${counts}; ${noiseText}. ${
      call === "within_noise"
        ? control.rate === 1
          ? "The original page already got the brand recommended in every answer, so there was no room to improve."
          : "The difference is inside that spread, so it is not read as an effect."
        : "The difference is larger than that spread. It describes a model handed this page, not what any engine will say."
    }`,
  };
}

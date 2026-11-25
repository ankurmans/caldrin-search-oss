export type SpendScope = {
  projectId: string;
  organizationId: string;
  userId: string;
};

// Every field is optional: null means no limit of that kind.
export type SpendLimits = {
  dailyUsd: number | null;
  monthlyUsd: number | null;
  scheduledJobsPerDay: number | null;
};

export type ProviderSpend = {
  provider: string;
  todayUsd: number;
  monthUsd: number;
};

export type SpendSummary = {
  todayUsd: number;
  monthUsd: number;
  byProvider: ProviderSpend[];
};

// An expected, user-facing refusal. Server functions turn it into a typed
// {ok:false, reason} result; callers must not continue a paid operation.
export class SpendLimitRefusal extends Error {
  /** True when the limits could not be read, not when one was reached. */
  readonly unverified: boolean;
  constructor(message: string, options: { unverified?: boolean } = {}) {
    super(message);
    this.name = "SpendLimitRefusal";
    this.unverified = options.unverified ?? false;
  }
}

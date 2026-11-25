// How a changed page's Google Analytics rows become ledger observations.
// Pure: no clock, no I/O. A window with no sessions yields no observation, and
// ecommerce readings are only written when the property has ecommerce data.

export type Ga4PageRow = {
  landingPage: string;
  sessions: number;
  transactions: number;
  purchaseRevenue: number;
};

type Ga4Totals = {
  sessions: number;
  transactions: number;
  purchaseRevenue: number;
};

type Ga4ObservationDraft = {
  metric: string;
  value: number;
  numerator: number | null;
  denominator: number | null;
};

function pathOf(value: string): string {
  try {
    return new URL(value).pathname.replace(/\/+$/, "");
  } catch {
    return value.split("?")[0]?.replace(/\/+$/, "") ?? "";
  }
}

// GA4's landing page is a path. "contains" would pull in /post-2 when asked for
// /post, so rows are narrowed again by exact path. The home page is matched
// exactly, because "contains /" is the whole site.
export function ga4PageFilterFor(targetUrl: string): {
  filter: { fieldName: "landingPage"; stringFilter: unknown };
  keepRow: (landingPage: string) => boolean;
} {
  const path = pathOf(targetUrl);
  if (path === "") {
    return {
      filter: {
        fieldName: "landingPage",
        stringFilter: { matchType: "EXACT", value: "/" },
      },
      keepRow: (landingPage) => pathOf(landingPage) === "",
    };
  }
  return {
    filter: {
      fieldName: "landingPage",
      stringFilter: { matchType: "CONTAINS", value: path },
    },
    keepRow: (landingPage) => pathOf(landingPage) === path,
  };
}

export function aggregateGa4Rows(rows: Ga4PageRow[]): Ga4Totals | null {
  let sessions = 0;
  let transactions = 0;
  let purchaseRevenue = 0;
  for (const row of rows) {
    sessions += row.sessions;
    transactions += row.transactions;
    purchaseRevenue += row.purchaseRevenue;
  }
  if (sessions <= 0) return null;
  return { sessions, transactions, purchaseRevenue };
}

export function ga4ObservationsFromTotals(
  totals: Ga4Totals,
  hasEcommerce: boolean,
): Ga4ObservationDraft[] {
  const drafts: Ga4ObservationDraft[] = [
    {
      metric: "ga4_organic_sessions",
      value: totals.sessions,
      numerator: null,
      denominator: null,
    },
  ];
  if (!hasEcommerce) return drafts;
  drafts.push(
    {
      metric: "ga4_ecommerce_transactions",
      value: totals.transactions,
      numerator: null,
      denominator: null,
    },
    {
      metric: "ga4_ecommerce_revenue",
      value: totals.purchaseRevenue,
      numerator: null,
      denominator: null,
    },
    {
      // Rates keep both parts so a reader can see the sample behind the number.
      metric: "ga4_organic_transaction_rate",
      value: totals.transactions / totals.sessions,
      numerator: totals.transactions,
      denominator: totals.sessions,
    },
  );
  return drafts;
}

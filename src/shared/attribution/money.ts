/** Digits after the decimal point for a currency, from the runtime's currency data. */
function currencyExponent(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** Whole units to minor units: "12.34" in USD is 1234, "500" in JPY is 500. */
export function toMinorUnits(amount: string, currency: string): number | null {
  const cleaned = amount.replace(/[\s,$€£¥]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 10 ** currencyExponent(currency));
}

export function formatMoney(minor: number, currency: string): string {
  const value = minor / 10 ** currencyExponent(currency);
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(
      value,
    );
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export type Money = { currency: string; minor: number };

/** Adds an amount to a per-currency list; currencies are never converted. */
export const addMoney = (
  list: Money[],
  currency: string | null,
  minor: number,
) => {
  if (!currency || minor === 0) return;
  const hit = list.find((m) => m.currency === currency);
  if (hit) hit.minor += minor;
  else list.push({ currency, minor });
};

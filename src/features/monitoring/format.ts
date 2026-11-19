import type { Locale } from "@/lib/i18n/locale";

export function formatMinorUnits(locale: Locale, amount: number, currency: string) {
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "code" });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 0;
  return formatter.format(amount / 10 ** digits);
}

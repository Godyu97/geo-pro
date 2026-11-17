import type { Locale } from "./locale";

export const statisticsTimeZone = "Asia/Shanghai";

export function formatNumber(locale: Locale, value: number) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

export function formatPercent(locale: Locale, value: number) {
  return new Intl.NumberFormat(locale, {
    style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1,
  }).format(value);
}

export function formatMoney(locale: Locale, value: number, currency: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}

export function formatDateTime(locale: Locale, value: Date, timeZone = statisticsTimeZone) {
  return new Intl.DateTimeFormat(locale, {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(value);
}

export function formatCount(locale: Locale, value: number, forms: { one: string; other: string }) {
  const form = new Intl.PluralRules(locale).select(value) === "one" ? forms.one : forms.other;
  return form.replaceAll("{count}", formatNumber(locale, value));
}

export const locales = ["zh-CN", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "zh-CN";
export const localeCookie = "geo-locale";

export function isLocale(value: unknown): value is Locale {
  return value === "zh-CN" || value === "en";
}

export function resolveLocale(
  preference?: string,
  acceptLanguage: string | null = null,
): Locale {
  // An invalid saved choice is never allowed to select an arbitrary language.
  if (preference !== undefined) {
    return isLocale(preference) ? preference : defaultLocale;
  }

  const languages = (acceptLanguage ?? "")
    .slice(0, 4096)
    .split(",")
    .map((item) => {
      const [tag, quality] = item.trim().toLowerCase().split(";");
      const match = quality?.trim().match(/^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/);
      return { tag, weight: quality === undefined ? 1 : match ? Number(match[1]) : 0 };
    })
    .filter(({ weight }) => weight > 0)
    .sort((a, b) => b.weight - a.weight);

  for (const { tag } of languages) {
    if (/^en(?:-[a-z0-9]+)*$/.test(tag)) return "en";
    if (["zh", "zh-cn", "zh-hans", "zh-hans-cn"].includes(tag)) return "zh-CN";
  }
  return defaultLocale;
}

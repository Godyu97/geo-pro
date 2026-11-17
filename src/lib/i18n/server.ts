import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";

import zhCN from "./messages/zh-CN.json";
import en from "./messages/en.json";
import { localeCookie, resolveLocale, type Locale } from "./locale";
import { createTranslator } from "./translate";

export type Messages = typeof zhCN;
const catalogs: Record<Locale, Messages> = { "zh-CN": zhCN, en };

// React cache deduplicates within a request; there is no mutable global locale.
export const getLocale = cache(async () => {
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  return resolveLocale(cookieStore.get(localeCookie)?.value, requestHeaders.get("accept-language"));
});

export function getMessages(locale: Locale) {
  return catalogs[locale];
}

export async function getTranslator<Domain extends keyof Messages>(domain: Domain) {
  const locale = await getLocale();
  return createTranslator(locale, catalogs[locale][domain], catalogs["zh-CN"][domain]);
}

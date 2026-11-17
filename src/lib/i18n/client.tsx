"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";

const LocaleContext = createContext<{
  locale: Locale;
  messages: Messages["common"];
} | null>(null);

export function LocaleProvider({ locale, messages, children }: {
  locale: Locale;
  messages: Messages["common"];
  children: ReactNode;
}) {
  return <LocaleContext.Provider value={{ locale, messages }}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("LocaleProvider is required");
  return { locale: context.locale, t: createTranslator(context.locale, context.messages) };
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LocaleProvider } from "@/lib/i18n/client";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator("common");
  return {
    title: { default: t("siteTitle"), template: "%s · GeoPro" },
    description: t("siteDescription"),
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = getMessages(locale).common;
  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full">
        <LocaleProvider locale={locale} messages={messages}>
          <a href="#main-content" className="skip-link">
            {messages.skip}
          </a>
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}

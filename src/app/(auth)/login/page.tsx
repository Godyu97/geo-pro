import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Fingerprint } from "lucide-react";

import { AuthForm } from "@/components/layout/auth-form";
import { BrandMark } from "@/components/layout/brand-mark";
import { Card, CardContent } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { isAuthConfigured } from "@/lib/auth/env";
import { safeReturnTo } from "@/lib/auth/return-to";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator("common");
  return { title: t("loginTitle"), robots: { index: false, follow: false } };
}
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; returnTo?: string }>;
}) {
  const { mode, returnTo } = await searchParams;
  const locale = await getLocale();
  const t = await getTranslator("auth");
  const common = await getTranslator("common");

  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-svh max-w-6xl flex-col px-5 py-8 sm:px-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <BrandMark />
        <div className="flex flex-wrap items-center gap-4">
          <LanguageSwitcher />
          <Link
            href="/"
            className="flex items-center gap-2 rounded text-sm text-muted-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            {common("backHome")}
          </Link>
        </div>
      </div>
      <div className="grid flex-1 items-center gap-14 py-12 lg:grid-cols-2 lg:gap-24">
        <div className="hidden lg:block">
          <span className="mb-7 flex size-14 items-center justify-center rounded-2xl bg-secondary text-primary">
            <Fingerprint className="size-7" aria-hidden="true" />
          </span>
          <h2 className="text-4xl leading-snug font-semibold tracking-tight">
            {t("introTitle")}
          </h2>
          <p className="mt-6 max-w-md text-base leading-8 text-muted-foreground">
            {t("introDescription")}
          </p>
          <p className="mt-12 border-l-2 border-primary/30 pl-4 text-sm leading-7 text-muted-foreground">
            {t("availability")}
          </p>
        </div>
        <Card className="mx-auto w-full max-w-md rounded-2xl shadow-sm">
          <CardContent className="p-6 sm:p-9">
            <h1 className="mb-2 text-2xl font-semibold tracking-tight">
              {t("welcome")}
            </h1>
            <p className="mb-7 text-sm leading-6 text-muted-foreground">
              {t("description")}
            </p>
            <AuthForm
              initialMode={mode === "signup" ? "signup" : "login"}
              configured={isAuthConfigured()}
              messages={getMessages(locale).auth}
              returnTo={safeReturnTo(returnTo)}
            />
            <p className="mt-6 text-center text-xs leading-6 text-muted-foreground">
              {t("emailNotice")}
            </p>
          </CardContent>
        </Card>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {common("siteTitle")}
      </p>
    </main>
  );
}

import type { Metadata } from "next";
import { BrandMark } from "@/components/layout/brand-mark";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { Card, CardContent } from "@/components/ui/card";
import { safeReturnTo } from "@/lib/auth/return-to";
import { getSessionState } from "@/lib/auth/session";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { AccountAccessForm } from "./access-form";
import { emailPageMode } from "./contracts";

type PageProps = { searchParams: Promise<{ mode?: string; returnTo?: string }> };

const descriptions = {
  verify: ["verifyTitle", "verifyDescription"],
  forgot: ["forgotTitle", "forgotDescription"],
  confirm: ["confirmTitle", "confirmDescription"],
  reset: ["resetTitle", "resetDescription"],
} as const;

async function pageDetails(searchParams: PageProps["searchParams"]) {
  const [params, locale] = await Promise.all([searchParams, getLocale()]);
  const mode = emailPageMode.catch("forgot").parse(params.mode);
  const messages = getMessages(locale);
  const [title, description] = descriptions[mode];
  return { mode, messages, title: messages.accountEmail[title], description: messages.accountEmail[description], returnTo: safeReturnTo(params.returnTo) };
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { title } = await pageDetails(searchParams);
  return { title, referrer: "no-referrer", robots: { index: false, follow: false } };
}

export default async function AccountAccessPage({ searchParams }: PageProps) {
  const [{ mode, messages, title, description, returnTo }, state] = await Promise.all([
    pageDetails(searchParams), getSessionState(),
  ]);
  const user = state.status === "authenticated" ? state.session.user : undefined;
  return (
    <main id="main-content" className="mx-auto flex min-h-svh max-w-3xl flex-col px-5 py-8 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <BrandMark />
        <LanguageSwitcher />
      </div>
      <div className="flex flex-1 items-center justify-center py-10">
        <Card className="w-full max-w-md rounded-2xl shadow-sm">
          <CardContent className="space-y-5 p-6 sm:p-9">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm leading-6 text-muted-foreground">{description}</p>
            <AccountAccessForm key={mode} mode={mode} returnTo={returnTo} signedIn={Boolean(user)}
              initialEmail={mode === "verify" ? user?.email : undefined}
              messages={messages.accountEmail} authMessages={messages.auth} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

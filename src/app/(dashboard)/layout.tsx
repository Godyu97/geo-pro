import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { SessionMonitor } from "@/components/layout/session-monitor";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { requireSession } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator("common");
  return { title: t("dashboardTitle"), robots: { index: false, follow: false } };
}
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = await requireSession();
  const locale = await getLocale();
  const messages = getMessages(locale);
  const t = await getTranslator("common");

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar messages={messages.dashboard} modules={messages.modules} />
        <SidebarInset className="min-w-0 bg-background">
          <SessionMonitor userId={user.id} />
          <header className="flex min-h-18 flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3 sm:px-8">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <SidebarTrigger aria-label={t("toggleSidebar")} />
              <Separator orientation="vertical" className="h-5!" />
              <span className="truncate text-sm font-medium">{t("overview")}</span>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <span className="hidden max-w-36 truncate text-xs text-muted-foreground sm:inline">
                {user.name}
              </span>
              <LanguageSwitcher />
              <SignOutButton />
            </div>
          </header>
          <main
            id="main-content"
            className="mx-auto w-full max-w-6xl p-5 sm:p-8 lg:p-10"
          >
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { SessionMonitor } from "@/components/layout/session-monitor";
import { WorkspaceAccountControls } from "@/components/layout/workspace-account-controls";
import { WorkspaceLocation } from "@/components/layout/workspace-location";
import type { WorkspaceSectionId } from "@/components/layout/workspace-section";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { requireSession } from "@/lib/auth/session";
import { brandIntakeDecision, type BrandIntakeMode } from "@/features/brands/intake";
import { feedbackBrandUnavailable } from "@/features/business-feedback/workspace";
import { calendarBrandUnavailable } from "@/features/content/calendar-workspace";
import { entityBrandUnavailable } from "@/features/entity-accuracy/access";
import { retestBrandUnavailable } from "@/features/formal-retest/workspace";

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
  const requestHeaders = await headers();
  // Reject inaccessible brands before the dashboard loading boundary can stream.
  const requestPath = requestHeaders.get("x-geo-path");
  if (await entityBrandUnavailable(user.id, requestPath)
    || await retestBrandUnavailable(user.id, requestPath)
    || await feedbackBrandUnavailable(user.id, requestPath)
    || await calendarBrandUnavailable(user.id, requestPath)) notFound();
  const locale = await getLocale();
  const messages = getMessages(locale);
  const t = await getTranslator("common");
  const settings = await getTranslator("settings");
  const decision = brandIntakeDecision(requestHeaders, user.email);
  let brandIntake: BrandIntakeMode | "closed" | "dev-denied" = "closed";
  if (decision.state === "denied") brandIntake = "dev-denied";
  if (decision.state === "open") brandIntake = decision.intake.mode;
  const locationLabels: Record<WorkspaceSectionId, string> = {
    overview: t("overview"),
    assistant: messages.dashboard.assistant,
    maintenance: t("maintenance"),
    settings: t("accountSettings"),
    brands: messages.modules.brandsTitle,
    prompts: messages.modules.promptsTitle,
    monitoring: messages.modules.monitoringTitle,
    citations: messages.modules.citationsTitle,
    competitors: messages.modules.competitorsTitle,
    optimization: messages.modules.optimizationTitle,
    content: messages.modules.contentTitle,
    reports: messages.modules.reportsTitle,
    orders: settings("serviceOrders"),
    deliveries: settings("deliveries"),
    entitlements: settings("entitlements"),
    workspace: t("dashboard"),
  };

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar messages={messages.dashboard} modules={messages.modules} brandIntake={brandIntake} />
        <SidebarInset className="min-w-0 bg-background">
          <SessionMonitor userId={user.id} />
          <header className="flex min-h-18 flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3 sm:px-8">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <SidebarTrigger aria-label={t("toggleSidebar")} />
              <Separator orientation="vertical" className="h-5!" />
              <WorkspaceLocation currentLocation={t("currentLocation")} labels={locationLabels} />
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <span className="hidden max-w-36 truncate text-xs text-muted-foreground sm:inline">
                {user.name}
              </span>
              <WorkspaceAccountControls />
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

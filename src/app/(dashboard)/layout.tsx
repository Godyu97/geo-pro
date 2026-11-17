import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { SignOutButton } from "@/components/layout/sign-out-button";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { requireSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "工作台",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = await requireSession();

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0 bg-background">
          <header className="flex min-h-18 items-center justify-between gap-3 border-b bg-card px-4 sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <SidebarTrigger aria-label="切换侧边导航" />
              <Separator orientation="vertical" className="h-5!" />
              <span className="truncate text-sm font-medium">工作台总览</span>
            </div>
            <div className="flex min-w-0 items-center gap-3">
              <span className="hidden max-w-36 truncate text-xs text-muted-foreground sm:inline">
                {user.name}
              </span>
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

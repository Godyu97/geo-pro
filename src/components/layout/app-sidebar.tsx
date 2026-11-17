"use client";

import Link from "next/link";
import { ArrowUpRight, LayoutDashboard, CircleHelp } from "lucide-react";

import { BrandMark } from "@/components/layout/brand-mark";
import { getModuleLinks } from "@/components/layout/module-links";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { useLocale } from "@/lib/i18n/client";

export function AppSidebar({ messages, modules }: { messages: Messages["dashboard"]; modules: Messages["modules"] }) {
  const { locale, t: common } = useLocale();
  const t = createTranslator(locale, messages);
  const moduleLinks = getModuleLinks(modules);
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar>
      <SidebarHeader className="px-6 py-7">
        <BrandMark />
        <p className="mt-2 text-xs text-muted-foreground">{t("subtitle")}</p>
      </SidebarHeader>
      <SidebarContent className="px-3">
        <nav aria-label={common("sidebarTitle")}>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive className="h-auto min-h-10 py-2">
                    <Link
                      href="/dashboard"
                      onClick={() => setOpenMobile(false)}
                    >
                      <LayoutDashboard aria-hidden="true" />
                      <span>{common("overview")}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>{t("modules")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {moduleLinks.map(({ id, title, icon: Icon }) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton asChild className="h-auto min-h-10 py-2">
                      <a
                        href={`#${id}`}
                        onClick={() => setOpenMobile(false)}
                      >
                        <Icon aria-hidden="true" />
                        <span className="min-w-0 flex-1 whitespace-normal break-words">{title}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                          {t("notOpen")}
                        </span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter className="gap-5 p-6">
        <div className="rounded-xl border bg-background p-3.5">
          <CircleHelp className="mb-2 size-4 text-primary" aria-hidden="true" />
          <p className="text-xs font-medium">{t("startingPoint")}</p>
          <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
            {t("sidebarEmpty")}
          </p>
        </div>
        <Link
          href="/"
          className="flex items-center justify-between rounded text-xs text-muted-foreground"
        >
          {t("backProduct")}
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </SidebarFooter>
    </Sidebar>
  );
}

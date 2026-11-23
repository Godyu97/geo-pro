"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, ClipboardList, LayoutDashboard, CircleHelp, Settings, ShieldCheck } from "lucide-react";

import { BrandMark } from "@/components/layout/brand-mark";
import { getModuleLinks } from "@/components/layout/module-links";
import { isWorkspaceSectionActive } from "@/components/layout/workspace-section";
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

import type { BrandIntakeMode } from "@/features/brands/pilot-admission";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { useLocale } from "@/lib/i18n/client";

const sidebarCopy = {
  fixture: "sidebarFixture",
  real: "sidebarReal",
  mock: "sidebarMock",
  dev: "sidebarDev",
  "dev-denied": "sidebarDevDenied",
  closed: "sidebarEmpty",
} as const;

export function AppSidebar({ messages, modules, brandIntake }: {
  messages: Messages["dashboard"];
  modules: Messages["modules"];
  brandIntake: BrandIntakeMode | "closed" | "dev-denied";
}) {
  const { locale, t: common } = useLocale();
  const t = createTranslator(locale, messages);
  const moduleLinks = getModuleLinks(modules);
  const { setOpenMobile } = useSidebar();
  const pathname = usePathname();
  const sectionActive = (section: string) => isWorkspaceSectionActive(pathname, section);

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
                  <SidebarMenuButton asChild isActive={sectionActive("overview")} className="h-auto min-h-10 rounded-lg py-2">
                    <Link
                      href="/dashboard"
                      aria-current={sectionActive("overview") ? "page" : undefined}
                      onClick={() => setOpenMobile(false)}
                    >
                      <LayoutDashboard aria-hidden="true" />
                      <span>{common("overview")}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={sectionActive("assistant")} className="h-auto min-h-10 rounded-lg py-2">
                    <Link
                      href="/dashboard/assistant"
                      aria-current={sectionActive("assistant") ? "page" : undefined}
                      onClick={() => setOpenMobile(false)}
                    >
                      <ClipboardList aria-hidden="true" />
                      <span className="whitespace-normal">{t("assistant")}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={sectionActive("maintenance")} className="h-auto min-h-10 rounded-lg py-2">
                    <Link href="/dashboard/maintenance" aria-current={sectionActive("maintenance") ? "page" : undefined} onClick={() => setOpenMobile(false)}>
                      <ShieldCheck aria-hidden="true" />
                      <span className="whitespace-normal">{common("maintenance")}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={sectionActive("settings")} className="h-auto min-h-10 rounded-lg py-2">
                    <Link
                      href="/dashboard/settings"
                      aria-current={sectionActive("settings") ? "page" : undefined}
                      onClick={() => setOpenMobile(false)}
                    >
                      <Settings aria-hidden="true" />
                      <span className="whitespace-normal">{common("accountSettings")}</span>
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
                {moduleLinks.map(({ id, title, icon: Icon }) => {
                  const brandEntry = id === "brands" && brandIntake !== "closed";
                  const active = sectionActive(id);
                  return (
                    <SidebarMenuItem key={id}>
                      <SidebarMenuButton asChild isActive={active} className="h-auto min-h-10 rounded-lg py-2">
                        <a
                          href={brandEntry ? "/dashboard/brands" : pathname === "/dashboard" ? `#${id}` : `/dashboard#${id}`}
                          aria-current={active ? "page" : undefined}
                          onClick={() => setOpenMobile(false)}
                        >
                          <Icon aria-hidden="true" />
                          <span className="min-w-0 flex-1 whitespace-normal break-words">{title}</span>
                          {!brandEntry && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{t("notOpen")}</span>}
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
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
            {t(sidebarCopy[brandIntake])}
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

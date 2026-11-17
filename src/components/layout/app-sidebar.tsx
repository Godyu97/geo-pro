"use client";

import Link from "next/link";
import { ArrowUpRight, LayoutDashboard, CircleHelp } from "lucide-react";

import { BrandMark } from "@/components/layout/brand-mark";
import { moduleLinks } from "@/components/layout/module-links";
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

export function AppSidebar() {
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar>
      <SidebarHeader className="px-6 py-7">
        <BrandMark />
        <p className="mt-2 text-xs text-muted-foreground">品牌可见度工作台</p>
      </SidebarHeader>
      <SidebarContent className="px-3">
        <nav aria-label="工作台导航">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive className="h-10">
                    <Link
                      href="/dashboard"
                      onClick={() => setOpenMobile(false)}
                    >
                      <LayoutDashboard aria-hidden="true" />
                      <span>工作台总览</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>功能模块</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {moduleLinks.map(({ id, title, icon: Icon }) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton asChild className="h-10">
                      <a
                        href={`/dashboard#${id}`}
                        onClick={() => setOpenMobile(false)}
                      >
                        <Icon aria-hidden="true" />
                        <span>{title}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          待开放
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
          <p className="text-xs font-medium">一个清晰的起点</p>
          <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
            业务模块尚未开放，当前没有监测结果。
          </p>
        </div>
        <Link
          href="/"
          className="flex items-center justify-between rounded text-xs text-muted-foreground"
        >
          返回产品首页
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </SidebarFooter>
    </Sidebar>
  );
}

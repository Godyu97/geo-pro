import { ArrowDown, FolderOpen, Leaf, ShieldCheck } from "lucide-react";

import { moduleLinks } from "@/components/layout/module-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/session";

export default async function DashboardPage() {
  // Each protected page checks the session, including RSC navigation requests.
  const { user } = await requireSession();

  return (
    <div className="space-y-9">
      <section className="rounded-2xl border bg-secondary/55 p-6 sm:p-8">
        <Badge variant="outline" className="mb-5 gap-1.5 bg-white/60">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          账号已连接
        </Badge>
        <h1 className="text-2xl leading-relaxed font-semibold tracking-tight sm:text-3xl">
          你好，<span className="break-words">{user.name}</span>
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
          欢迎来到品牌可见度工作台。这里将连接品牌资料、回答证据与内容动作，帮助你理解
          AI 中的品牌表现。
        </p>
        <Button asChild variant="outline" className="mt-6 bg-white/70">
          <a href="#modules">
            查看模块状态
            <ArrowDown aria-hidden="true" />
          </a>
        </Button>
      </section>
      <section
        aria-labelledby="evidence-title"
        className="rounded-2xl border border-dashed bg-card px-6 py-9 text-center sm:px-9"
      >
        <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <FolderOpen
            className="size-5 text-muted-foreground"
            aria-hidden="true"
          />
        </span>
        <h2 id="evidence-title" className="font-medium">
          等待第一份真实证据
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-7 text-muted-foreground">
          当前暂无监测数据。业务模块开放后，你可以从品牌资料和客户问题开始，逐步建立自己的观察记录。
        </p>
      </section>
      <section id="modules" aria-labelledby="modules-title">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 id="modules-title" className="text-lg font-semibold">
            工作台模块
          </h2>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Leaf className="size-3.5 text-primary" aria-hidden="true" />
            逐步建设，持续完善
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {moduleLinks.map(({ id, title, icon: Icon, description, empty }) => (
            <Card key={id} id={id} className="scroll-mt-6 shadow-none">
              <CardContent className="p-6">
                <div className="mb-5 flex items-center justify-between">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <Badge
                    variant="outline"
                    className="font-normal text-muted-foreground"
                  >
                    尚未开放
                  </Badge>
                </div>
                <h3 className="font-medium">{title}</h3>
                <p className="mt-2 min-h-14 text-sm leading-7 text-muted-foreground">
                  {description}
                </p>
                <p className="mt-5 border-t pt-4 text-xs text-muted-foreground">
                  {empty}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

import Link from "next/link";
import {
  ArrowRight,
  Check,
  CircleDot,
  FileCheck2,
  Quote,
  Route,
} from "lucide-react";

import { BrandMark } from "@/components/layout/brand-mark";
import { moduleLinks } from "@/components/layout/module-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const steps = [
  { icon: CircleDot, title: "真实购买问题", description: "从客户关心的事开始" },
  { icon: Quote, title: "可追溯的回答证据", description: "保留原文与观察条件" },
  {
    icon: FileCheck2,
    title: "有依据的内容动作",
    description: "确认事实，记录改变",
  },
  { icon: Route, title: "同口径复测", description: "理解变化，也说明限制" },
];

export default function HomePage() {
  return (
    <>
      <header className="border-b bg-background/95">
        <nav
          aria-label="主导航"
          className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8"
        >
          <BrandMark />
          <a
            href="#capabilities"
            className="hidden rounded text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
          >
            产品能力
          </a>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost">
              <Link href="/login">登录</Link>
            </Button>
            <Button asChild>
              <Link href="/dashboard">
                进入控制台
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </nav>
      </header>
      <main id="main-content">
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div>
            <Badge variant="secondary" className="mb-6 gap-2 px-3 py-1.5">
              <span className="size-1.5 rounded-full bg-primary" />
              面向中国大陆品牌经营者
            </Badge>
            <h1 className="max-w-xl text-4xl leading-[1.25] font-semibold tracking-tight sm:text-5xl">
              GEO 品牌可见度
              <br />
              <span className="text-primary">监测与优化平台</span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-8 text-muted-foreground">
              看清 AI
              如何理解你的品牌。以真实回答为起点，连接可核验的证据、内容动作与效果复测。
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/login?mode=signup">
                  开始体验
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <a href="#capabilities">了解产品方向</a>
              </Button>
            </div>
            <p className="mt-5 text-sm leading-6 text-muted-foreground">
              当前可创建账号并进入工作台，监测与优化功能正在筹备。
            </p>
            <div className="mt-9 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
              {["以证据为依据", "区分未知与未提及", "不承诺固定排名"].map(
                (text) => (
                  <span key={text} className="flex items-center gap-1.5">
                    <Check
                      className="size-3.5 text-primary"
                      aria-hidden="true"
                    />
                    {text}
                  </span>
                ),
              )}
            </div>
          </div>
          <div className="rounded-3xl border bg-card p-5 shadow-[0_18px_65px_-30px_#537a7838] sm:p-7">
            <div className="mb-7 flex items-center justify-between border-b pb-5">
              <span className="text-sm font-medium">从问题，到下一步行动</span>
              <Badge variant="outline">产品方向</Badge>
            </div>
            <ol className="space-y-5">
              {steps.map(({ icon: Icon, title, description }, index) => (
                <li key={title} className="flex items-center gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-secondary text-primary">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{title}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {description}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    0{index + 1}
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-7 rounded-xl border border-dashed bg-muted/50 px-4 py-3 text-xs leading-6 text-muted-foreground">
              这里将展示真实监测案例。当前尚无公开案例与效果数据。
            </div>
          </div>
        </section>
        <section id="capabilities" className="scroll-mt-8 border-y bg-white/55">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
            <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mb-3 text-xs font-medium tracking-[0.2em] text-primary">
                  围绕真实证据
                </p>
                <h2 className="text-2xl font-semibold tracking-tight">
                  让每一步，都有据可循
                </h2>
              </div>
              <p className="text-sm text-muted-foreground">
                以下为规划能力，尚未开放业务操作
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {moduleLinks.map(({ id, title, icon: Icon, description }) => (
                <Card key={id} className="shadow-none">
                  <CardContent className="p-6">
                    <Icon
                      className="mb-5 size-5 text-primary"
                      aria-hidden="true"
                    />
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="font-medium">{title}</h3>
                      <span className="text-xs text-muted-foreground">
                        筹备中
                      </span>
                    </div>
                    <p className="text-sm leading-7 text-muted-foreground">
                      {description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>
      </main>
      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-xs text-muted-foreground sm:px-8">
        <p>GeoPro · 让品牌观察回到真实证据</p>
        <p>基础工作台已开放 · 业务能力逐步建设</p>
      </footer>
    </>
  );
}

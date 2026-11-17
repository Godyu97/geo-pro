import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Fingerprint } from "lucide-react";

import { AuthForm } from "@/components/layout/auth-form";
import { BrandMark } from "@/components/layout/brand-mark";
import { Card, CardContent } from "@/components/ui/card";
import { isAuthConfigured } from "@/lib/auth/env";

export const metadata: Metadata = {
  title: "登录",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;

  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-svh max-w-6xl flex-col px-5 py-8 sm:px-8"
    >
      <div className="flex items-center justify-between">
        <BrandMark />
        <Link
          href="/"
          className="flex items-center gap-2 rounded text-sm text-muted-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          返回首页
        </Link>
      </div>
      <div className="grid flex-1 items-center gap-14 py-12 lg:grid-cols-2 lg:gap-24">
        <div className="hidden lg:block">
          <span className="mb-7 flex size-14 items-center justify-center rounded-2xl bg-secondary text-primary">
            <Fingerprint className="size-7" aria-hidden="true" />
          </span>
          <h2 className="text-4xl leading-snug font-semibold tracking-tight">
            你的品牌，
            <br />
            从真实证据开始。
          </h2>
          <p className="mt-6 max-w-md text-base leading-8 text-muted-foreground">
            建立一个清晰的观察起点。未来的每份回答、每次内容动作，都应有来源，也有边界。
          </p>
          <p className="mt-12 border-l-2 border-primary/30 pl-4 text-sm leading-7 text-muted-foreground">
            当前已开放基础账号与工作台。
            <br />
            GEO 监测与优化模块尚未开放。
          </p>
        </div>
        <Card className="mx-auto w-full max-w-md rounded-2xl shadow-sm">
          <CardContent className="p-6 sm:p-9">
            <h1 className="mb-2 text-2xl font-semibold tracking-tight">
              欢迎来到 GeoPro
            </h1>
            <p className="mb-7 text-sm leading-6 text-muted-foreground">
              登录或创建账号，进入你的工作台。
            </p>
            <AuthForm
              initialMode={mode === "signup" ? "signup" : "login"}
              configured={isAuthConfigured()}
            />
            <p className="mt-6 text-center text-xs leading-6 text-muted-foreground">
              邮箱用于账号登录。当前未提供邮件验证与密码找回。
            </p>
          </CardContent>
        </Card>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        GeoPro · GEO 品牌可见度监测与优化平台
      </p>
    </main>
  );
}

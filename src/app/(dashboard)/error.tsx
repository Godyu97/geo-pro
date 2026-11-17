"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-5 p-6 text-center">
      <h1 className="text-xl font-semibold">暂时无法载入工作台</h1>
      <p className="text-sm text-muted-foreground">
        账号服务可能暂不可用，请稍后重试。
      </p>
      <div className="flex gap-3">
        <Button onClick={reset}>重新加载</Button>
        <Button asChild variant="outline">
          <Link href="/login">返回登录</Link>
        </Button>
      </div>
    </div>
  );
}

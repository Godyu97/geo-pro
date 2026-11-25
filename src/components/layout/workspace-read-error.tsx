import "server-only";

import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getTranslator } from "@/lib/i18n/server";

export const workspaceActionClass = "h-auto min-h-10 max-w-full whitespace-normal py-2 text-center";

export async function WorkspaceReadError({ title, message, reloadHref, backHref, backLabel, logEvent }: {
  title: string;
  message: string;
  reloadHref: string;
  backHref: string;
  backLabel: string;
  logEvent: string;
}) {
  const t = await getTranslator("common");
  const traceId = randomUUID();
  console.error(logEvent, { traceId });

  return (
    <header className="min-w-0 space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p role="alert" className="max-w-2xl text-sm leading-7 text-destructive">{message}</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild className={workspaceActionClass}><a href={reloadHref}>{t("retry")}</a></Button>
        <Button asChild variant="outline" className={workspaceActionClass}>
          <Link href={backHref} prefetch={false}>{backLabel}</Link>
        </Button>
      </div>
      <p className="text-xs wrap-anywhere text-muted-foreground">{t("readTrace", { id: traceId })}</p>
    </header>
  );
}

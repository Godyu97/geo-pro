import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { currentMaintenanceAccess } from "../maintenance/service";
import { CapabilityEditor } from "./editor";
import { CapabilityRetryButton } from "./retry-button";
import { readMaintenanceCapabilities } from "./service";

export async function generateMetadata() {
  const t = await getTranslator("capabilities");
  return { title: t("maintenanceTitle"), robots: { index: false, follow: false } };
}

export default async function CapabilityMaintenancePage() {
  const { user } = await requireSession();
  const access = await currentMaintenanceAccess("capabilities.manage");
  const t = await getTranslator("capabilities");
  const locale = await getLocale();
  const result = access.status === "allowed" ? await readMaintenanceCapabilities() : null;

  return (
    <div className="space-y-7">
      <div>
        <ShieldCheck className="mb-4 size-7 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-semibold tracking-tight">{t("maintenanceTitle")}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("maintenanceDescription")}</p>
      </div>
      {access.status !== "allowed" ? (
        <section role={access.status === "unavailable" ? "alert" : "status"} className="rounded-xl border bg-card p-5">
          <p className="font-medium">{t(access.status === "unavailable" ? "SERVICE_UNAVAILABLE" : "FORBIDDEN")}</p>
          <p className="mt-2 break-all text-xs text-muted-foreground">{t("trace", { id: access.traceId })}</p>
        </section>
      ) : !result || !result.items ? (
        <section role="alert" className="space-y-2 rounded-xl border bg-card p-5 text-sm">
          <p>{t("SERVICE_UNAVAILABLE")}</p>
          <CapabilityRetryButton label={t("retry")} />
          <p className="break-all text-muted-foreground">{t("trace", { id: result?.traceId ?? access.traceId })}</p>
        </section>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t("privacy")}</p>
          {result.items.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
          <div className="grid gap-3">
            {result.items.map((item) => (
              <article key={`${item.channelId}:${item.version}`} className="min-w-0 space-y-2 rounded-xl border bg-card p-5 text-sm">
                <h2 className="font-medium wrap-anywhere">{item.displayName}</h2>
                <p className="text-muted-foreground">{t(item.kind)} · {t(item.status)} · v{item.version}</p>
                <p className="wrap-anywhere text-muted-foreground">{t("sop")}: {item.sopSummary}</p>
                <p className="wrap-anywhere text-muted-foreground">{t("limits")}: {item.limitsSummary}</p>
              </article>
            ))}
          </div>
          <section aria-labelledby="record-heading" className="rounded-xl border bg-card p-5">
            <h2 id="record-heading" className="mb-4 font-medium">{t("recordHeading")}</h2>
            <CapabilityEditor
              actorId={user.id}
              locale={locale}
              messages={getMessages(locale).capabilities}
              channels={result.items}
            />
          </section>
        </>
      )}
      <Button asChild variant="outline" className="h-auto min-h-10 whitespace-normal py-2">
        <Link href="/dashboard/maintenance"><ArrowLeft aria-hidden="true" />{t("backMaintenance")}</Link>
      </Button>
    </div>
  );
}

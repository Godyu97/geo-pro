import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadDeliveryWorkspace } from "./delivery-commands.ts";
import { DeliveriesPanel } from "./deliveries-panel";

const path = "/dashboard/commercial/deliveries";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal";

export async function generateMetadata() {
  const t = await getTranslator("deliveries");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function DeliveriesPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("deliveries");
  let workspace = null;
  try {
    workspace = await loadDeliveryWorkspace(getConnection(), user.id);
  } catch {
    console.error("deliveries-page-unavailable");
  }
  const canRegister = Boolean(workspace?.brands.length);
  const hasDeliveries = Boolean(workspace?.deliveries.length);
  const firstPending = workspace?.deliveries.find((delivery) => delivery.status === "pending");

  return (
    <div className="min-w-0 space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        {workspace ? (
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{t("description")}</p>
        ) : (
          <p role="alert" className="text-sm leading-6 text-destructive">{t("SERVICE_UNAVAILABLE")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {!workspace ? (
            <Button asChild className={actionClass}><a href={path}>{t("reload")}</a></Button>
          ) : (
            <>
              {firstPending && (
                <Button asChild className={actionClass}>
                  <a href={`#brand-delivery-${firstPending.id}`}>{t("reviewPending")}</a>
                </Button>
              )}
              {canRegister && (
                <Button asChild variant={firstPending ? "outline" : "default"} className={actionClass}>
                  <a href="#brand-delivery-brand">{t("startRegistration")}</a>
                </Button>
              )}
              {hasDeliveries && !firstPending && (
                <Button asChild variant={canRegister ? "outline" : "default"} className={actionClass}>
                  <a href="#brand-deliveries-list-heading">{t("viewDeliveries")}</a>
                </Button>
              )}
              {!canRegister && !hasDeliveries && (
                <Button asChild className={actionClass}>
                  <Link href="/dashboard/brands" prefetch={false}>{t("openBrands")}</Link>
                </Button>
              )}
            </>
          )}
          <Button asChild variant="outline" className={actionClass}>
            <Link href="/dashboard/settings" prefetch={false}>{t("backSettings")}</Link>
          </Button>
        </div>
      </header>
      {workspace && <DeliveriesPanel workspace={workspace} messages={getMessages(locale).deliveries} />}
    </div>
  );
}

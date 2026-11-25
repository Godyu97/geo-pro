import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadOrderWorkspace } from "./order-commands.ts";
import { OrdersPanel } from "./orders-panel";

const path = "/dashboard/commercial/orders";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal";

export async function generateMetadata() {
  const t = await getTranslator("orders");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function OrdersPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("orders");
  let workspace = null;
  try {
    workspace = await loadOrderWorkspace(getConnection(), user.id);
  } catch {
    console.error("orders-page-unavailable");
  }
  const canRegister = Boolean(workspace?.brands.length);
  const hasOrders = Boolean(workspace?.orders.length);

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
              {canRegister && (
                <Button asChild className={actionClass}>
                  <a href="#service-order-brand">{t("startRegistration")}</a>
                </Button>
              )}
              {hasOrders && (
                <Button asChild variant={canRegister ? "outline" : "default"} className={actionClass}>
                  <a href="#service-orders-heading">{t("viewOrders")}</a>
                </Button>
              )}
              {!canRegister && (
                <Button asChild variant={hasOrders ? "outline" : "default"} className={actionClass}>
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
      {workspace && <OrdersPanel workspace={workspace} messages={getMessages(locale).orders} />}
    </div>
  );
}

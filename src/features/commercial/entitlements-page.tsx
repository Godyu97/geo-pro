import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadEntitlementWorkspace } from "./entitlement-commands.ts";
import { EntitlementsPanel } from "./entitlements-panel";

const path = "/dashboard/commercial/entitlements";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal";

export async function generateMetadata() {
  const t = await getTranslator("entitlements");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function EntitlementsPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("entitlements");
  const messages = getMessages(locale).entitlements;
  let workspace = null;
  try {
    workspace = await loadEntitlementWorkspace(getConnection(), user.id);
  } catch {
    console.error("entitlements-page-unavailable");
  }
  const canRegister = Boolean(workspace?.brands.length);
  const hasVersions = Boolean(workspace?.entitlements.length);

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
          {workspace ? (
            <>
              {hasVersions && (
                <Button asChild className={actionClass}>
                  <a href="#service-entitlements-list-heading">{t("viewVersions")}</a>
                </Button>
              )}
              {canRegister && (
                <Button asChild variant={hasVersions ? "outline" : "default"} className={actionClass}>
                  <a href="#service-entitlement-brand">{t("startRegistration")}</a>
                </Button>
              )}
              {!canRegister && !hasVersions && (
                <Button asChild className={actionClass}>
                  <Link href="/dashboard/brands" prefetch={false}>{t("openBrands")}</Link>
                </Button>
              )}
            </>
          ) : (
            <Button asChild className={actionClass}><a href={path}>{t("reload")}</a></Button>
          )}
          <Button asChild variant="ghost" className={actionClass}>
            <Link href="/dashboard/settings" prefetch={false}>{t("backSettings")}</Link>
          </Button>
        </div>
      </header>
      {workspace && <EntitlementsPanel workspace={workspace} messages={messages} />}
    </div>
  );
}

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadShareWorkspace } from "./share-commands.ts";
import { SharesPanel } from "./shares-panel";

const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal";

export async function generateMetadata() {
  const t = await getTranslator("shares");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function SharesPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("shares");
  const messages = getMessages(locale).shares;
  let workspace = null;
  try {
    workspace = await loadShareWorkspace(getConnection(), user.id);
  } catch {
    console.error("shares-page-unavailable");
  }
  const hasBrands = Boolean(workspace?.brands.length);
  const canRegister = Boolean(hasBrands && workspace?.snapshots.length);
  const hasShares = Boolean(workspace?.shares.length);

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
              {hasShares && (
                <Button asChild className={actionClass}>
                  <a href="#whitelabel-shares-heading">{t("viewHistory")}</a>
                </Button>
              )}
              {canRegister && (
                <Button asChild variant={hasShares ? "outline" : "default"} className={actionClass}>
                  <a href="#whitelabel-share-brand">{t("startRegistration")}</a>
                </Button>
              )}
              {hasBrands && !canRegister && (
                <Button asChild variant={hasShares ? "outline" : "default"} className={actionClass}>
                  <Link href="/dashboard/reports" prefetch={false}>{t("openReports")}</Link>
                </Button>
              )}
              {!hasBrands && !hasShares && (
                <Button asChild className={actionClass}>
                  <Link href="/dashboard/brands" prefetch={false}>{t("openBrands")}</Link>
                </Button>
              )}
            </>
          ) : (
            <Button asChild className={actionClass}>
              <Link href="/dashboard/reports/shares" prefetch={false}>{t("reload")}</Link>
            </Button>
          )}
          <Button asChild variant="ghost" className={actionClass}>
            <Link href="/dashboard/reports" prefetch={false}>{t("backReports")}</Link>
          </Button>
        </div>
      </header>
      {workspace && <SharesPanel workspace={workspace} messages={messages} now={new Date().toISOString()} />}
    </div>
  );
}

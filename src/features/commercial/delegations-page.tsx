import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { listDelegationWorkspace } from "./commands.ts";
import { DelegationsPanel } from "./delegations-panel";

const path = "/dashboard/settings/delegations";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal";

export async function generateMetadata() {
  const t = await getTranslator("delegations");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function DelegationsPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("delegations");
  const now = new Date().toISOString();
  let workspace = null;
  try {
    workspace = await listDelegationWorkspace(getConnection(), user.id, now);
  } catch {
    console.error("delegations-page-unavailable");
  }
  const hasBrand = Boolean(workspace?.brands.length);
  const hasManaged = Boolean(workspace?.managed.length);
  const hasPortfolio = Boolean(workspace?.portfolio.length);
  const canExpire = workspace?.managed.some(({ active }) => active === 1);

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
              {hasManaged && (
                <Button asChild variant={canExpire || !hasBrand ? "default" : "outline"} className={actionClass}>
                  <a href="#delegation-managed-heading">{t(canExpire ? "manageDelegations" : "reviewHistory")}</a>
                </Button>
              )}
              {hasBrand && (
                <Button asChild variant={canExpire ? "outline" : "default"} className={actionClass}>
                  <a href="#delegation-brand">{t("startRegistration")}</a>
                </Button>
              )}
              {hasPortfolio && (
                <Button asChild variant={hasManaged || hasBrand ? "outline" : "default"} className={actionClass}>
                  <a href="#delegation-portfolio-heading">{t("viewPortfolio")}</a>
                </Button>
              )}
              {!hasBrand && !hasManaged && !hasPortfolio && (
                <Button asChild className={actionClass}>
                  <a href="#delegation-organization">{t("startMembership")}</a>
                </Button>
              )}
            </>
          )}
          <Button asChild variant="outline" className={actionClass}>
            <Link href="/dashboard/settings" prefetch={false}>{t("backSettings")}</Link>
          </Button>
        </div>
      </header>
      {workspace && <DelegationsPanel workspace={workspace} now={now} messages={getMessages(locale).delegations} />}
    </div>
  );
}

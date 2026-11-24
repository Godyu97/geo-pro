import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { listSyncAuthorizations } from "./revocation-commands.ts";
import { SyncAuthorizationsPanel } from "./revocation-panel";

const syncPath = "/dashboard/settings/sync-authorizations";
const brandFieldId = "sync-authorization-brand";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal";
const summaryClass = "max-w-2xl text-sm leading-6 text-muted-foreground";

async function readWorkspace(ownerId: string) {
  try {
    const connection = getConnection();
    const workspace = await listSyncAuthorizations(connection, ownerId);
    const labels = await loadOwnedLabels(connection, workspace.brands.map((brand) => brand.id));
    return { ...workspace, labels };
  } catch {
    console.error("sync-authorizations-page-unavailable");
    return null;
  }
}

export async function generateMetadata() {
  const t = await getTranslator("syncAuthorizations");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function SyncAuthorizationsPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("syncAuthorizations");
  const workspace = await readWorkspace(user.id);
  const canRegister = Boolean(workspace?.brands.length);
  const activeAuthorization = workspace?.authorizations.find((record) => !record.revoked);
  const firstAuthorization = activeAuthorization ?? workspace?.authorizations[0];

  return (
    <div className="min-w-0 space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        {workspace ? (
          <p className={summaryClass}>{t(canRegister ? "fixtureNote" : "noBrands")}</p>
        ) : (
          <p role="alert" className="text-sm leading-6 text-destructive">{t("SERVICE_UNAVAILABLE")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {!workspace ? (
            <Button asChild className={actionClass}><a href={syncPath}>{t("reload")}</a></Button>
          ) : (
            <>
              {canRegister ? (
                <Button asChild variant={activeAuthorization ? "outline" : "default"} className={actionClass}>
                  <a href={`#${brandFieldId}`}>{t("startRegistration")}</a>
                </Button>
              ) : (
                <Button asChild className={actionClass}>
                  <Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link>
                </Button>
              )}
              {firstAuthorization ? (
                <Button asChild variant={activeAuthorization && canRegister ? "default" : "outline"} className={actionClass}>
                  <a href={`#sync-authorization-${firstAuthorization.id}`}>{t(activeAuthorization ? "reviewActive" : "reviewHistory")}</a>
                </Button>
              ) : null}
            </>
          )}
          <Button asChild variant="outline" className={actionClass}>
            <Link href="/dashboard/settings" prefetch={false}>{t("backSettings")}</Link>
          </Button>
        </div>
        {workspace && (canRegister || firstAuthorization) ? (
          <>
            {!canRegister ? <p className={summaryClass}>{t("fixtureNote")}</p> : null}
            <p className={summaryClass}>{t("description")}</p>
          </>
        ) : null}
      </header>
      {workspace ? (
        <SyncAuthorizationsPanel {...workspace} brandFieldId={brandFieldId} messages={getMessages(locale).syncAuthorizations} />
      ) : null}
    </div>
  );
}

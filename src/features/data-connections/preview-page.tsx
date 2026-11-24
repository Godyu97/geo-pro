import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { listDataConnections } from "./commands.ts";
import { DataConnectionsPanel } from "./preview-panel";

const connectionsPath = "/dashboard/settings/data-connections";
const brandFieldId = "data-connection-brand";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal";
const summaryClass = "max-w-2xl text-sm leading-6 text-muted-foreground";

async function readWorkspace(ownerId: string) {
  try {
    const connection = getConnection();
    const workspace = await listDataConnections(connection, ownerId);
    const labels = await loadOwnedLabels(connection, workspace.brands.map((brand) => brand.id));
    return { ...workspace, labels };
  } catch {
    console.error("data-connections-page-unavailable");
    return null;
  }
}

export async function generateMetadata() {
  const t = await getTranslator("dataConnections");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function DataConnectionsPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("dataConnections");
  const workspace = await readWorkspace(user.id);
  const canRegister = Boolean(workspace?.brands.length);
  const pendingPreview = workspace?.connections.find((record) => record.status === "preview");

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
            <Button asChild className={actionClass}><a href={connectionsPath}>{t("reload")}</a></Button>
          ) : !canRegister ? (
            <Button asChild className={actionClass}>
              <Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link>
            </Button>
          ) : (
            <>
              {pendingPreview ? (
                <Button asChild className={actionClass}>
                  <a href={`#connection-${pendingPreview.id}`}>{t("reviewPreview")}</a>
                </Button>
              ) : null}
              <Button asChild variant={pendingPreview ? "outline" : "default"} className={actionClass}>
                <a href={`#${brandFieldId}`}>{t("startRegistration")}</a>
              </Button>
            </>
          )}
          <Button asChild variant="outline" className={actionClass}>
            <Link href="/dashboard/settings" prefetch={false}>{t("backSettings")}</Link>
          </Button>
        </div>
        {workspace && (canRegister || workspace.connections.length > 0) ? (
          <>
            {!canRegister ? <p className={summaryClass}>{t("fixtureNote")}</p> : null}
            <p className={summaryClass}>{t("description")}</p>
          </>
        ) : null}
      </header>
      {workspace ? (
        <DataConnectionsPanel {...workspace} brandFieldId={brandFieldId} messages={getMessages(locale).dataConnections} />
      ) : null}
    </div>
  );
}

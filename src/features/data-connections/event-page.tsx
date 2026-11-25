import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { listDataConnections } from "./commands.ts";
import { listConnectorEvents } from "./event-commands.ts";
import { ConnectorEventsPanel } from "./event-panel";

const connectorEventsPath = "/dashboard/reports/connector-events";
const rowsFieldId = "connector-event-rows";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal";
const summaryClass = "max-w-2xl text-sm leading-6 text-muted-foreground";

async function readWorkspace(ownerId: string) {
  try {
    const connection = getConnection();
    const workspace = await listConnectorEvents(connection, ownerId);
    const listed = await listDataConnections(connection, ownerId);
    const labels = await loadOwnedLabels(connection, workspace.brands.map((brand) => brand.id));
    return { ...workspace, connections: listed.connections, labels };
  } catch {
    console.error("connector-events-page-unavailable");
    return null;
  }
}

export async function generateMetadata() {
  const t = await getTranslator("connectorEvents");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function ConnectorEventsPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("connectorEvents");
  const workspace = await readWorkspace(user.id);
  const canImport = Boolean(workspace?.brands.length);

  return (
    <div className="min-w-0 space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        {workspace ? (
          <p className={summaryClass}>{t(canImport ? "fixtureNote" : "noBrands")}</p>
        ) : (
          <p role="alert" className="text-sm leading-6 text-destructive">{t("SERVICE_UNAVAILABLE")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {!workspace ? (
            <Button asChild className={actionClass}><a href={connectorEventsPath}>{t("reload")}</a></Button>
          ) : canImport ? (
            <Button asChild className={actionClass}><a href={`#${rowsFieldId}`}>{t("startImport")}</a></Button>
          ) : (
            <Button asChild className={actionClass}>
              <Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link>
            </Button>
          )}
          <Button asChild variant="outline" className={actionClass}>
            <Link href="/dashboard/reports" prefetch={false}>{t("backReports")}</Link>
          </Button>
        </div>
        {workspace ? (
          <>
            {!canImport && workspace.events.length > 0 ? <p className={summaryClass}>{t("fixtureNote")}</p> : null}
            {canImport || workspace.events.length > 0 ? <p className={summaryClass}>{t("description")}</p> : null}
          </>
        ) : null}
      </header>
      {workspace ? (
        <ConnectorEventsPanel {...workspace} rowsFieldId={rowsFieldId} messages={getMessages(locale).connectorEvents} />
      ) : null}
    </div>
  );
}

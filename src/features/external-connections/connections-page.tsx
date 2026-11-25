import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { listExternalConnections } from "./commands.ts";
import { ConnectionsPanel } from "./connections-panel";

const path = "/dashboard/settings/connections";
const brandFieldId = "external-connection-brand";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal";

async function readWorkspace(ownerId: string) {
  try {
    const connection = getConnection();
    const workspace = await listExternalConnections(connection, ownerId);
    const labels = await loadOwnedLabels(connection, workspace.brands.map((brand) => brand.id));
    return { ...workspace, labels };
  } catch {
    console.error("external-connections-page-unavailable");
    return null;
  }
}

export async function generateMetadata() {
  const t = await getTranslator("externalConnections");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function ExternalConnectionsPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("externalConnections");
  const workspace = await readWorkspace(user.id);
  const canRegister = Boolean(workspace?.brands.length);
  const currentConnection = workspace?.connections.find((connection) => connection.status !== "revoked");
  const firstConnection = currentConnection ?? workspace?.connections[0];

  return (
    <div className="min-w-0 space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        {workspace ? (
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{t(canRegister || firstConnection ? "fixtureNote" : "noBrands")}</p>
        ) : (
          <p role="alert" className="text-sm leading-6 text-destructive">{t("SERVICE_UNAVAILABLE")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {firstConnection && (
            <Button asChild className={actionClass}>
              <a href={`#external-connection-${firstConnection.id}`}>{t(currentConnection ? "reviewConnection" : "reviewHistory")}</a>
            </Button>
          )}
          {!workspace ? (
            <Button asChild className={actionClass}><a href={path}>{t("reload")}</a></Button>
          ) : canRegister ? (
            <Button asChild variant={firstConnection ? "outline" : "default"} className={actionClass}>
              <a href={`#${brandFieldId}`}>{t("startRegistration")}</a>
            </Button>
          ) : (
            <Button asChild variant={firstConnection ? "outline" : "default"} className={actionClass}>
              <Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link>
            </Button>
          )}
          <Button asChild variant="outline" className={actionClass}>
            <Link href="/dashboard/settings" prefetch={false}>{t("backSettings")}</Link>
          </Button>
        </div>
      </header>
      {workspace && (canRegister || firstConnection) && (
        <>
          <ConnectionsPanel {...workspace} brandFieldId={brandFieldId} messages={getMessages(locale).externalConnections} />
          <details className="rounded-xl border bg-card p-4 text-sm">
            <summary className="cursor-pointer rounded-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">{t("workflowDetails")}</summary>
            <p className="mt-3 max-w-3xl leading-6 text-muted-foreground">{t("description")}</p>
          </details>
        </>
      )}
    </div>
  );
}

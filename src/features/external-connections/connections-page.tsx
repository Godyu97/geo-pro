import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { listExternalConnections } from "./commands.ts";
import { ConnectionsPanel } from "./connections-panel";

export async function generateMetadata() {
  const t = await getTranslator("externalConnections");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function ExternalConnectionsPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("externalConnections");
  const messages = getMessages(locale).externalConnections;
  let workspace = null;
  let labels: { brandId: string; name: string }[] = [];
  try {
    workspace = await listExternalConnections(getConnection(), user.id);
    labels = await loadOwnedLabels(getConnection(), workspace.brands.map((brand) => brand.id));
  } catch {
    console.error("external-connections-page-unavailable");
  }
  if (!workspace) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p role="alert" className="text-sm leading-6 text-destructive">{t("SERVICE_UNAVAILABLE")}</p>
        <Link href="/dashboard/settings" prefetch={false} className="inline-block text-sm underline underline-offset-4">{t("backSettings")}</Link>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("description")}</p>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("fixtureNote")}</p>
      </div>
      <ConnectionsPanel brands={workspace.brands} connections={workspace.connections} labels={labels} messages={messages} />
      <Link href="/dashboard/settings" prefetch={false} className="inline-block text-sm underline underline-offset-4">{t("backSettings")}</Link>
    </div>
  );
}

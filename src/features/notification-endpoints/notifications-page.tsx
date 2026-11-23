import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { listNotificationEndpoints } from "./commands.ts";
import { NotificationsPanel } from "./notifications-panel";

export async function generateMetadata() {
  const t = await getTranslator("notificationEndpoints");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function NotificationEndpointsPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("notificationEndpoints");
  const messages = getMessages(locale).notificationEndpoints;
  let workspace = null;
  let labels: { brandId: string; name: string }[] = [];
  try {
    workspace = await listNotificationEndpoints(getConnection(), user.id);
    labels = await loadOwnedLabels(getConnection(), workspace.brands.map((brand) => brand.id));
  } catch {
    console.error("notification-endpoints-page-unavailable");
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
      <NotificationsPanel brands={workspace.brands} endpoints={workspace.endpoints} labels={labels} messages={messages} />
      <Link href="/dashboard/settings" prefetch={false} className="inline-block text-sm underline underline-offset-4">{t("backSettings")}</Link>
    </div>
  );
}

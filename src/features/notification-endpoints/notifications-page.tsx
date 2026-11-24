import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { listNotificationEndpoints } from "./commands.ts";
import { NotificationsPanel } from "./notifications-panel";

const path = "/dashboard/settings/notifications";
const brandFieldId = "notification-endpoint-brand";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal";

async function readWorkspace(ownerId: string) {
  try {
    const connection = getConnection();
    const workspace = await listNotificationEndpoints(connection, ownerId);
    const labels = await loadOwnedLabels(connection, workspace.brands.map((brand) => brand.id));
    return { ...workspace, labels };
  } catch {
    console.error("notification-endpoints-page-unavailable");
    return null;
  }
}

export async function generateMetadata() {
  const t = await getTranslator("notificationEndpoints");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function NotificationEndpointsPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("notificationEndpoints");
  const workspace = await readWorkspace(user.id);
  const canRegister = Boolean(workspace?.brands.length);
  const activeEndpoint = workspace?.endpoints.find((endpoint) => endpoint.status === "verified");
  const firstEndpoint = activeEndpoint ?? workspace?.endpoints[0];

  return (
    <div className="min-w-0 space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        {workspace ? (
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{t(canRegister || firstEndpoint ? "fixtureNote" : "noBrands")}</p>
        ) : (
          <p role="alert" className="text-sm leading-6 text-destructive">{t("SERVICE_UNAVAILABLE")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {firstEndpoint ? (
            <Button asChild className={actionClass}>
              <a href={`#notification-endpoint-${firstEndpoint.id}`}>{t(activeEndpoint ? "reviewEndpoint" : "reviewHistory")}</a>
            </Button>
          ) : null}
          {!workspace ? (
            <Button asChild className={actionClass}><a href={path}>{t("reload")}</a></Button>
          ) : canRegister ? (
            <Button asChild variant={firstEndpoint ? "outline" : "default"} className={actionClass}>
              <a href={`#${brandFieldId}`}>{t("startRegistration")}</a>
            </Button>
          ) : (
            <Button asChild variant={firstEndpoint ? "outline" : "default"} className={actionClass}>
              <Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link>
            </Button>
          )}
          <Button asChild variant="outline" className={actionClass}>
            <Link href="/dashboard/settings" prefetch={false}>{t("backSettings")}</Link>
          </Button>
        </div>
        {workspace && (canRegister || firstEndpoint) ? (
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{t("description")}</p>
        ) : null}
      </header>
      {workspace ? (
        <NotificationsPanel {...workspace} brandFieldId={brandFieldId} messages={getMessages(locale).notificationEndpoints} />
      ) : null}
    </div>
  );
}

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadDeliveryWorkspace } from "./delivery-commands.ts";
import { DeliveriesPanel } from "./deliveries-panel";

export async function generateMetadata() {
  const t = await getTranslator("deliveries");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function DeliveriesPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("deliveries");
  const messages = getMessages(locale).deliveries;
  let workspace = null;
  try {
    workspace = await loadDeliveryWorkspace(getConnection(), user.id);
  } catch {
    console.error("deliveries-page-unavailable");
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
      <DeliveriesPanel workspace={workspace} messages={messages} />
      <Link href="/dashboard/settings" prefetch={false} className="inline-block text-sm underline underline-offset-4">{t("backSettings")}</Link>
    </div>
  );
}

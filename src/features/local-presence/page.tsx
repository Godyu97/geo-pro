import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { listLocalObservations } from "./commands.ts";
import { LocalObservationsPanel } from "./panel";

export async function generateMetadata() {
  const t = await getTranslator("localObservations");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function LocalObservationsPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("localObservations");
  const messages = getMessages(locale).localObservations;
  let workspace = null;
  let labels: { brandId: string; name: string }[] = [];
  try {
    workspace = await listLocalObservations(getConnection(), user.id);
    labels = await loadOwnedLabels(getConnection(), workspace.brands.map((brand) => brand.id));
  } catch {
    console.error("local-observations-page-unavailable");
  }
  if (!workspace) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p role="alert" className="text-sm leading-6 text-destructive">{t("SERVICE_UNAVAILABLE")}</p>
        <Link href="/dashboard/brands" prefetch={false} className="inline-block text-sm underline underline-offset-4">{t("backBrands")}</Link>
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
      <LocalObservationsPanel brands={workspace.brands} observations={workspace.observations} labels={labels} messages={messages} />
      <Link href="/dashboard/brands" prefetch={false} className="inline-block text-sm underline underline-offset-4">{t("backBrands")}</Link>
    </div>
  );
}

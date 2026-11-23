import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { listBrandStores } from "./store-commands.ts";
import { BrandStoresPanel } from "./stores-panel";

export async function generateMetadata() {
  const t = await getTranslator("brandStores");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function BrandStoresPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("brandStores");
  const messages = getMessages(locale).brandStores;
  let workspace = null;
  let labels: { brandId: string; name: string }[] = [];
  try {
    workspace = await listBrandStores(getConnection(), user.id);
    labels = await loadOwnedLabels(getConnection(), workspace.brands.map((brand) => brand.id));
  } catch {
    console.error("brand-stores-page-unavailable");
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
      <BrandStoresPanel brands={workspace.brands} stores={workspace.stores} uses={workspace.uses} labels={labels} messages={messages} />
      <Link href="/dashboard/brands" prefetch={false} className="inline-block text-sm underline underline-offset-4">{t("backBrands")}</Link>
    </div>
  );
}

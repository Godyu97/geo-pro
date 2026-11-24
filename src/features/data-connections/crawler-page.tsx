import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { listCrawlerVisits } from "./crawler-commands.ts";
import { CrawlerVisitsPanel } from "./crawler-panel";

const crawlerVisitsPath = "/dashboard/reports/crawler-visits";
const brandFieldId = "crawler-visit-brand";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal";
const summaryClass = "max-w-2xl text-sm leading-6 text-muted-foreground";

async function readWorkspace(ownerId: string) {
  try {
    const connection = getConnection();
    const workspace = await listCrawlerVisits(connection, ownerId);
    const labels = await loadOwnedLabels(connection, workspace.brands.map((brand) => brand.id));
    return { ...workspace, labels };
  } catch {
    console.error("crawler-visits-page-unavailable");
    return null;
  }
}

export async function generateMetadata() {
  const t = await getTranslator("crawlerVisits");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function CrawlerVisitsPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("crawlerVisits");
  const workspace = await readWorkspace(user.id);
  const canRegister = Boolean(workspace?.brands.length);

  return (
    <div className="min-w-0 space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        {workspace ? (
          <p className={summaryClass}>{t(canRegister ? "description" : "noBrands")}</p>
        ) : (
          <p role="alert" className="text-sm leading-6 text-destructive">{t("SERVICE_UNAVAILABLE")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {!workspace ? (
            <Button asChild className={actionClass}><a href={crawlerVisitsPath}>{t("reload")}</a></Button>
          ) : canRegister ? (
            <Button asChild className={actionClass}><a href={`#${brandFieldId}`}>{t("startRegistration")}</a></Button>
          ) : (
            <Button asChild className={actionClass}>
              <Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link>
            </Button>
          )}
          <Button asChild variant="outline" className={actionClass}>
            <Link href="/dashboard/reports" prefetch={false}>{t("backReports")}</Link>
          </Button>
        </div>
        {workspace ? <p className={summaryClass}>{t("fixtureNote")}</p> : null}
      </header>
      {workspace ? (
        <CrawlerVisitsPanel {...workspace} brandFieldId={brandFieldId} messages={getMessages(locale).crawlerVisits} />
      ) : null}
    </div>
  );
}

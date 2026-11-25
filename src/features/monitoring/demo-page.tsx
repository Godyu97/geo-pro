import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { listDemoBrands, listDemoObservations } from "./demo-commands.ts";
import type { DemoObservationView } from "./demo-contracts.ts";
import { DemoObservationForm } from "./demo-panel";

const demoPath = "/dashboard/monitoring/demo";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal";

export async function generateMetadata() {
  const t = await getTranslator("demoObservations");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function DemoObservationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireSession();
  const params = await searchParams;
  const locale = await getLocale();
  const t = await getTranslator("demoObservations");
  const parsedBrand = brandIdSchema.safeParse(params.brandId);
  let notice: "INVALID_INPUT" | "NOT_FOUND" | "SERVICE_UNAVAILABLE" | null =
    params.brandId !== undefined && !parsedBrand.success ? "INVALID_INPUT" : null;
  let currentBrandId = "";
  let brandName = "";
  let observations: DemoObservationView[] = [];
  let selectedBrandId = "";
  try {
    const connection = getConnection();
    const [currentBrand] = await listDemoBrands(connection, user.id);
    currentBrandId = currentBrand?.id ?? "";
    if (!notice) {
      selectedBrandId = parsedBrand.success ? parsedBrand.data : currentBrandId;
      if (selectedBrandId) {
        const listed = await listDemoObservations(connection, user.id, selectedBrandId);
        if ("error" in listed) notice = listed.error === "NOT_FOUND" ? "NOT_FOUND" : "SERVICE_UNAVAILABLE";
        else observations = listed.observations;
      }
    }
    if (!notice && selectedBrandId) {
      const [label] = await loadOwnedLabels(connection, [selectedBrandId]);
      brandName = label?.name ?? selectedBrandId;
    }
  } catch {
    console.error("demo-observations-page-unavailable");
    notice = "SERVICE_UNAVAILABLE";
  }

  const unavailable = notice === "SERVICE_UNAVAILABLE";
  const hasSelection = !notice && Boolean(selectedBrandId);
  const hasHistory = hasSelection && observations.length > 0;
  const canRegister = hasSelection && selectedBrandId === currentBrandId;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

  return (
    <div className="min-w-0 space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <Badge variant="outline">{t("demoBadge")}</Badge>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("description")}</p>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("notVerified")}</p>
        {notice && <p role="alert" className="text-sm leading-6 text-destructive">{t(notice)}</p>}
        <div className="flex flex-wrap gap-2">
          {unavailable ? (
            <Button asChild className={actionClass}>
              <a href={parsedBrand.success ? `${demoPath}?brandId=${parsedBrand.data}` : demoPath}>{t("reload")}</a>
            </Button>
          ) : (
            <>
              {hasHistory && (
                <Button asChild className={actionClass}>
                  <a href="#demo-observation-history">{t("viewHistory")}</a>
                </Button>
              )}
              {canRegister && (
                <Button asChild variant={hasHistory ? "outline" : "default"} className={actionClass}>
                  <a href="#demo-observation-question">{t("startRegistration")}</a>
                </Button>
              )}
              {!canRegister && currentBrandId && (
                <Button asChild variant={hasHistory ? "outline" : "default"} className={actionClass}>
                  <Link href={`${demoPath}?brandId=${currentBrandId}`} prefetch={false}>{t("viewCurrentBrand")}</Link>
                </Button>
              )}
              {!currentBrandId && (
                <Button asChild variant={hasHistory ? "outline" : "default"} className={actionClass}>
                  <Link href="/dashboard/brands" prefetch={false}>{t("openBrands")}</Link>
                </Button>
              )}
            </>
          )}
          <Button asChild variant="ghost" className={actionClass}>
            <Link href="/dashboard/monitoring/overview" prefetch={false}>{t("backMonitoring")}</Link>
          </Button>
        </div>
      </header>

      {!unavailable && !hasSelection && !currentBrandId && (
        <p className="rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground">{t("noBrands")}</p>
      )}
      {canRegister && (
        <DemoObservationForm key={selectedBrandId} brandId={selectedBrandId} brandName={brandName} messages={getMessages(locale).demoObservations} />
      )}
      {hasSelection && (
        <section aria-labelledby="demo-observation-history" className="space-y-3">
          <h2 id="demo-observation-history" tabIndex={-1} className="text-lg font-semibold">{t("history")}</h2>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{brandName}</p>
          {observations.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="space-y-3">
              {observations.map((observation) => (
                <li key={observation.id} className="min-w-0 space-y-2 rounded-xl border bg-card p-5">
                  <Badge variant="outline">{t("demoBadge")}</Badge>
                  <p className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">{observation.questionText}</p>
                  <p className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">{observation.answerText}</p>
                  <p className="text-sm leading-6 text-muted-foreground">{t("createdAt", { time: when.format(new Date(observation.createdAt)) })}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

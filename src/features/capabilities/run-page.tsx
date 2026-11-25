import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/session";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { MonitoringRegistration } from "../monitoring/registration";
import { readRegistration } from "../monitoring/service";
import { RunConfirmForm } from "./run-confirm";
import { readUserCapabilities } from "./service";

const confirmPath = "/dashboard/monitoring/new";
const overviewPath = "/dashboard/monitoring/overview";
const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center";
const relatedLinkClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 whitespace-normal [overflow-wrap:anywhere] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export async function generateMetadata() {
  const t = await getTranslator("capabilities");
  return { title: t("runTitle"), robots: { index: false, follow: false } };
}

export default async function RunConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const query = await searchParams;
  const requested = Array.isArray(query.brandId) ? query.brandId[0] : query.brandId;
  const locale = await getLocale();
  const [t, tm, tb] = await Promise.all([
    getTranslator("capabilities"),
    getTranslator("monitoring"),
    getTranslator("brands"),
  ]);
  const [result, registration] = await Promise.all([
    readUserCapabilities(),
    readRegistration(session.user.id, requested),
  ]);
  const retryHref = requested ? `${confirmPath}?brandId=${encodeURIComponent(requested)}` : confirmPath;

  if (!("items" in result) || !result.items || registration.kind === "unavailable") {
    const traceId = !("items" in result)
      ? result.traceId
      : registration.kind === "unavailable"
        ? registration.traceId
        : "unavailable";
    return (
      <div className="min-w-0 space-y-6">
        <header className="min-w-0 space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">{t("runTitle")}</h1>
          <p role="alert" className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("SERVICE_UNAVAILABLE")}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild className={actionClass}>
              <a href={retryHref}>{tm("retry")}</a>
            </Button>
            <Button asChild variant="outline" className={actionClass}>
              <Link href={overviewPath} prefetch={false}>{t("backMonitoring")}</Link>
            </Button>
          </div>
          <p className="break-all text-xs text-muted-foreground">{t("trace", { id: traceId })}</p>
        </header>
      </div>
    );
  }

  const primaryAction = registration.kind === "no-brand" ? (
    <Button asChild className={actionClass}>
      <Link href="/dashboard/brands/new" prefetch={false}>{tm("openBrand")}</Link>
    </Button>
  ) : registration.kind === "not-found" || registration.kind === "archived" ? (
    <Button asChild className={actionClass}>
      <Link href="/dashboard/brands" prefetch={false}>{tb("allBrands")}</Link>
    </Button>
  ) : registration.sets.length === 0 ? (
    <Button asChild className={actionClass}>
      <Link href={`/dashboard/brands/${registration.brand.id}/questions`} prefetch={false}>{tm("openQuestions")}</Link>
    </Button>
  ) : (
    <Button asChild className={actionClass}>
      <a href="#monitoring-registration">{tm("title")}</a>
    </Button>
  );

  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("runTitle")}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("runDescription")}</p>
        <div className="flex flex-wrap gap-2">
          {primaryAction}
          <Button asChild variant="outline" className={actionClass}>
            <Link href={overviewPath} prefetch={false}>{t("backMonitoring")}</Link>
          </Button>
          {registration.kind === "ready" && (
            <Button asChild variant="outline" className={actionClass}>
              <Link href={`/dashboard/brands/${registration.brand.id}`} prefetch={false}>{t("openBrand")}</Link>
            </Button>
          )}
        </div>
        <nav aria-label={t("relatedEntries")} className="flex min-w-0 flex-wrap gap-2">
          <Link href="/dashboard/monitoring/protocols" prefetch={false} className={relatedLinkClass}>
            {t("openProtocols")}
          </Link>
          <Link href="/dashboard/settings#monitoring-capabilities" prefetch={false} className={relatedLinkClass}>
            {t("openSettings")}
          </Link>
        </nav>
      </header>
      <Card id="channel-eligibility" className="min-w-0 py-0 shadow-none">
        <RunConfirmForm locale={locale} messages={getMessages(locale).capabilities} channels={result.items} />
      </Card>
      <MonitoringRegistration brandId={requested} initialResult={registration} />
    </div>
  );
}

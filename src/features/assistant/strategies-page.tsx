import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { readStrategyWorkspace, strategyWorkspaceUnavailable } from "./strategy-commands";
import { strategyTemplateErrors, type StrategyTemplateError } from "./strategy-contracts";
import { StrategiesWorkspace, StrategyJump } from "./strategies-workspace";

const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center";
const relatedLinkClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 whitespace-normal [overflow-wrap:anywhere] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function isKnownError(value: string | undefined): value is StrategyTemplateError {
  return typeof value === "string" && Object.hasOwn(strategyTemplateErrors, value);
}

export async function generateMetadata() {
  const t = await getTranslator("strategyTemplates");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function StrategyTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const locale = await getLocale();
  const t = await getTranslator("strategyTemplates");
  const messages = getMessages(locale).strategyTemplates;
  const queryError = typeof params.error === "string" ? params.error : undefined;
  const errorCode = isKnownError(queryError) ? queryError : null;
  const result = await readStrategyWorkspace(getConnection(), session.user.id).catch(strategyWorkspaceUnavailable);

  if ("error" in result) {
    return (
      <div className="min-w-0 space-y-6">
        <header className="min-w-0 space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">{messages.title}</h1>
          <p role="alert" className="max-w-2xl text-sm leading-7 text-destructive">{messages.SERVICE_UNAVAILABLE}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild className={actionClass}>
              <a href="/dashboard/assistant/strategies">{messages.reload}</a>
            </Button>
            <Button asChild variant="outline" className={actionClass}>
              <Link href="/dashboard/assistant" prefetch={false}>{messages.backAssistant}</Link>
            </Button>
          </div>
          <p className="text-xs break-all text-muted-foreground">{t("trace", { id: result.traceId })}</p>
        </header>
      </div>
    );
  }

  if (result.kind === "no-brand") {
    return (
      <div className="min-w-0 space-y-6">
        <header className="min-w-0 space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>
          <Button asChild className={actionClass}>
            <Link href="/dashboard/brands" prefetch={false}>{t("openBrand")}</Link>
          </Button>
          <nav aria-label={t("relatedEntries")} className="flex min-w-0 flex-wrap gap-2">
            <Link href="/dashboard/assistant" prefetch={false} className={relatedLinkClass}>{t("backAssistant")}</Link>
            <Link href="/dashboard" prefetch={false} className={relatedLinkClass}>{t("backOverview")}</Link>
          </nav>
        </header>
      </div>
    );
  }

  const hasTemplates = result.templates.length > 0;
  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("description")}</p>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("fixtureNote")}</p>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{hasTemplates ? t("savedTask") : t("emptyTask")}</p>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{t("activeBrand")}</span>
          <span className="min-w-0 [overflow-wrap:anywhere]">{result.brandName}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasTemplates ? (
            <Button asChild className={actionClass}>
              <StrategyJump href="#strategy-list">{t("viewTemplates")}</StrategyJump>
            </Button>
          ) : (
            <Button asChild className={actionClass}>
              <StrategyJump href="#strategy-industry">{t("fillTemplate")}</StrategyJump>
            </Button>
          )}
          <Button asChild variant="outline" className={actionClass}>
            <Link href="/dashboard/assistant" prefetch={false}>{t("backAssistant")}</Link>
          </Button>
          <Button asChild variant="outline" className={actionClass}>
            <Link href="/dashboard" prefetch={false}>{t("backOverview")}</Link>
          </Button>
        </div>
        <nav aria-label={t("relatedEntries")} className="flex min-w-0 flex-wrap gap-2">
          <Link href="/dashboard/assistant" prefetch={false} className={relatedLinkClass}>{t("backAssistant")}</Link>
          <Link href="/dashboard/brands" prefetch={false} className={relatedLinkClass}>{t("openBrands")}</Link>
          <Link href="/dashboard" prefetch={false} className={relatedLinkClass}>{t("backOverview")}</Link>
        </nav>
      </header>
      <StrategiesWorkspace
        brandId={result.brandId}
        locale={locale}
        initialTemplates={result.templates}
        messages={messages}
        initialError={errorCode}
      />
    </div>
  );
}

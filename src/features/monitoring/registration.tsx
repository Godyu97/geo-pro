import Link from "next/link";
import { headers } from "next/headers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/session";
import { hasVerifiedEmail } from "@/lib/auth/verified-email";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { brandIntakeOrigin } from "@/features/brands/intake";
import { ApplyMockQuotaButton } from "@/features/functional-mock/run-buttons";
import { CapabilityRetryButton } from "../capabilities/retry-button";
import { RegistrationForm } from "./registration-form";
import { readRegistration } from "./service";

type RegistrationResult = Awaited<ReturnType<typeof readRegistration>>;
const emptyClass = "min-w-0 space-y-3 rounded-xl border border-dashed bg-muted/20 p-4 text-sm leading-6";
const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center";

export async function MonitoringRegistration({
  brandId,
  initialResult,
}: {
  brandId?: string;
  initialResult?: RegistrationResult;
}) {
  const session = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("monitoring");
  const messages = getMessages(locale).monitoring;
  const intake = brandIntakeOrigin(await headers());
  const result = initialResult ?? await readRegistration(session.user.id, brandId);
  if (result.kind === "unavailable") {
    return (
      <section aria-labelledby="monitoring-registration" className="min-w-0">
        <Card id="monitoring-registration" className="min-w-0 py-0 shadow-none">
          <CardContent className="space-y-3 p-5 sm:p-6">
            <h2 id="monitoring-registration" className="text-base font-semibold tracking-tight">{t("title")}</h2>
            <p role="alert" className="text-sm leading-6 text-muted-foreground">{t("unavailable")}</p>
            <CapabilityRetryButton label={t("retry")} />
            <p className="break-all text-xs text-muted-foreground">{t("trace", { id: result.traceId })}</p>
          </CardContent>
        </Card>
      </section>
    );
  }
  return (
    <section aria-labelledby="monitoring-registration" className="min-w-0">
      <Card id="monitoring-registration" className="min-w-0 scroll-mt-24 py-0 shadow-none">
        <CardContent className="min-w-0 space-y-5 p-5 sm:p-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="monitoring-registration" className="text-base font-semibold tracking-tight">{t("title")}</h2>
              {result.kind === "ready" && (
                <Badge variant="secondary" className="max-w-full whitespace-normal [overflow-wrap:anywhere]">
                  {result.brand.name}
                </Badge>
              )}
            </div>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("description")}</p>
          </div>
          {intake?.mode === "mock" && result.kind === "ready" && (
            <div className="space-y-2 rounded-xl border bg-muted/30 p-4">
              <p className="text-sm leading-6 text-muted-foreground">{t("mockQuotaNote")}</p>
              <ApplyMockQuotaButton
                brandId={result.brand.id}
                label={t("applyMockQuota")}
                pendingLabel={t("mockQuotaPending")}
                doneLabel={t("mockQuotaDone")}
                failedLabel={t("mockQuotaFailed")}
              />
            </div>
          )}
          {result.kind === "not-found" && <p className={emptyClass}>{t("NOT_FOUND")}</p>}
          {result.kind === "archived" && <p className={emptyClass}>{t("archivedBrand")}</p>}
          {result.kind === "no-brand" && (
            <div className={emptyClass}>
              <p>{t("noBrand")}</p>
              <Button asChild variant="outline" className={actionClass}>
                <Link href="/dashboard/brands/new" prefetch={false}>{t("openBrand")}</Link>
              </Button>
            </div>
          )}
          {result.kind === "ready" && result.sets.length === 0 && (
            <div className={emptyClass}>
              <p>{t("noPromptSet")}</p>
              <Button asChild variant="outline" className={actionClass}>
                <Link href={`/dashboard/brands/${result.brand.id}/questions`} prefetch={false}>{t("openQuestions")}</Link>
              </Button>
            </div>
          )}
          {result.kind === "ready" && result.sets.length > 0 && (
            <RegistrationForm
              key={result.brand.id}
              locale={locale}
              messages={messages}
              brandId={result.brand.id}
              brandName={result.brand.name}
              sets={result.sets}
              channels={result.channels}
              grant={result.grant}
              recent={result.recent}
              emailVerified={hasVerifiedEmail(session.user)}
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

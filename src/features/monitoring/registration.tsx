import Link from "next/link";
import { headers } from "next/headers";
import { requireSession } from "@/lib/auth/session";
import { hasVerifiedEmail } from "@/lib/auth/verified-email";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { brandIntakeOrigin } from "@/features/brands/intake";
import { ApplyMockQuotaButton } from "@/features/functional-mock/run-buttons";
import { CapabilityRetryButton } from "../capabilities/retry-button";
import { RegistrationForm } from "./registration-form";
import { readRegistration } from "./service";

export async function MonitoringRegistration({ brandId }: { brandId?: string }) {
  const session = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("monitoring");
  const messages = getMessages(locale).monitoring;
  const intake = brandIntakeOrigin(await headers());
  const result = await readRegistration(session.user.id, brandId);
  if (result.kind === "unavailable") {
    return (
      <section aria-labelledby="monitoring-registration" className="space-y-3 rounded-xl border p-5">
        <h2 id="monitoring-registration" className="font-medium">{t("title")}</h2>
        <p role="alert" className="text-sm">{t("unavailable")}</p>
        <CapabilityRetryButton label={t("retry")} />
        <p className="break-all text-sm text-muted-foreground">{t("trace", { id: result.traceId })}</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="monitoring-registration" className="space-y-4 rounded-xl border p-5">
      <div>
        <h2 id="monitoring-registration" className="font-medium">{t("title")}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
      </div>
      {intake?.mode === "mock" && result.kind === "ready" && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t("mockQuotaNote")}</p>
          <ApplyMockQuotaButton
            brandId={result.brand.id}
            label={t("applyMockQuota")}
            pendingLabel={t("mockQuotaPending")}
            doneLabel={t("mockQuotaDone")}
            failedLabel={t("mockQuotaFailed")}
          />
        </div>
      )}
      {result.kind === "not-found" && <p className="text-sm">{t("NOT_FOUND")}</p>}
      {result.kind === "archived" && <p className="text-sm">{t("archivedBrand")}</p>}
      {result.kind === "no-brand" && (
        <p className="text-sm">
          {t("noBrand")} <Link className="underline underline-offset-4" href="/dashboard/brands/new" prefetch={false}>{t("openBrand")}</Link>
        </p>
      )}
      {result.kind === "ready" && result.sets.length === 0 && (
        <p className="text-sm">
          {t("noPromptSet")} <Link className="underline underline-offset-4" href={`/dashboard/brands/${result.brand.id}/questions`} prefetch={false}>{t("openQuestions")}</Link>
        </p>
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
    </section>
  );
}

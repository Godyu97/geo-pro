import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { hasVerifiedEmail } from "@/lib/auth/verified-email";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { CapabilityRetryButton } from "../capabilities/retry-button";
import { RegistrationForm } from "./registration-form";
import { readRegistration } from "./service";

export async function MonitoringRegistration() {
  const session = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("monitoring");
  const messages = getMessages(locale).monitoring;
  const result = await readRegistration(session.user.id);
  if ("traceId" in result && !("brand" in result)) {
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
      {!result.brand && (
        <p className="text-sm">
          {t("noBrand")} <Link className="underline underline-offset-4" href="/dashboard/brands/new" prefetch={false}>{t("openBrand")}</Link>
        </p>
      )}
      {result.brand && result.sets.length === 0 && (
        <p className="text-sm">
          {t("noPromptSet")} <Link className="underline underline-offset-4" href={`/dashboard/brands/${result.brand.id}/questions`} prefetch={false}>{t("openQuestions")}</Link>
        </p>
      )}
      {result.brand && result.sets.length > 0 && (
        <RegistrationForm
          locale={locale}
          messages={messages}
          brandId={result.brand.id}
          sets={result.sets}
          channels={result.channels}
          grant={result.grant}
          recent={result.recent}
          emailVerified={hasVerifiedEmail(session.user)}
        />
      )}
      {result.traceId && <p className="break-all text-sm text-muted-foreground">{t("trace", { id: result.traceId })}</p>}
    </section>
  );
}

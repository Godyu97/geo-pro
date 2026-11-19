import { requireSession } from "@/lib/auth/session";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { CapabilityRetryButton } from "./retry-button";
import { RunConfirmForm } from "./run-confirm";
import { readUserCapabilities } from "./service";

export async function generateMetadata() {
  const t = await getTranslator("capabilities");
  return { title: t("runTitle"), robots: { index: false, follow: false } };
}

export default async function RunConfirmPage() {
  await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("capabilities");
  const result = await readUserCapabilities();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("runTitle")}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("runDescription")}</p>
      </div>
      {!result.items ? (
        <div role="alert" className="space-y-2 text-sm">
          <p>{t("SERVICE_UNAVAILABLE")}</p>
          <CapabilityRetryButton label={t("retry")} />
          <p className="break-all text-muted-foreground">{t("trace", { id: result.traceId })}</p>
        </div>
      ) : (
        <RunConfirmForm locale={locale} messages={getMessages(locale).capabilities} channels={result.items} />
      )}
    </div>
  );
}

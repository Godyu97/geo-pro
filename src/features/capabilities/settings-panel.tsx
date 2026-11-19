import "server-only";

import Link from "next/link";
import { formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { getTranslator } from "@/lib/i18n/server";
import { CapabilityRetryButton } from "./retry-button";
import { readUserCapabilities } from "./service";

export async function MonitoringCapabilityPanel({ locale }: { locale: Locale }) {
  const [t, result] = await Promise.all([getTranslator("capabilities"), readUserCapabilities()]);
  if (!result.items) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{t("SERVICE_UNAVAILABLE")}</p>
        <CapabilityRetryButton label={t("retry")} />
        <p className="break-all text-muted-foreground">{t("trace", { id: result.traceId })}</p>
      </div>
    );
  }

  const formal = result.items.filter((item) => item.eligibility === "eligible");
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">{t(formal.length ? "formalAvailable" : "noneFormal")}</p>
      {result.items.length === 0 && <p className="text-muted-foreground">{t("empty")}</p>}
      <div className="grid min-w-0 gap-3">
        {result.items.map((item) => (
          <article key={item.channelId} className="min-w-0 space-y-2 rounded-lg border p-3">
            <h3 className="font-medium wrap-anywhere">{item.displayName}</h3>
            <p className="text-muted-foreground">{t(item.kind)} · {t(item.eligibility)}</p>
            <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)] gap-x-2 gap-y-1 wrap-anywhere">
              <dt>{t("vendor")}</dt><dd>{item.vendorId}</dd>
              <dt>{t("productEntry")}</dt><dd>{item.productEntry}</dd>
              <dt>{t("modelVersion")}</dt><dd>{item.modelVersion}</dd>
              <dt>{t("limits")}</dt><dd>{item.limitsSummary}</dd>
              {item.verifiedAt && <>
                <dt>{t("verifiedAt")}</dt>
                <dd><time dateTime={item.verifiedAt}>{formatDateTime(locale, new Date(item.verifiedAt))}</time></dd>
              </>}
              {item.expiresAt && <>
                <dt>{t("expiresAt")}</dt>
                <dd><time dateTime={item.expiresAt}>{formatDateTime(locale, new Date(item.expiresAt))}</time></dd>
              </>}
            </dl>
          </article>
        ))}
      </div>
      <p>
        <Link href="/dashboard/monitoring/new" prefetch={false} className="underline underline-offset-4">{t("runConfirm")}</Link>
      </p>
    </div>
  );
}

import "server-only";

import Link from "next/link";
import { headers } from "next/headers";
import { formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { getTranslator } from "@/lib/i18n/server";
import { brandIntakeOrigin } from "@/features/brands/intake";
import { ApplyMockChannelsButton } from "@/features/functional-mock/channel-button";
import { mockVendorId } from "@/features/functional-mock/channels";
import { CapabilityRetryButton } from "./retry-button";
import { readUserCapabilities } from "./service";

export async function MonitoringCapabilityPanel({ locale }: { locale: Locale }) {
  const [t, result, intake] = await Promise.all([
    getTranslator("capabilities"),
    readUserCapabilities(),
    headers().then((value) => brandIntakeOrigin(value)),
  ]);
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
  const realFormal = formal.filter((item) => item.vendorId !== mockVendorId);
  const mockFormal = formal.filter((item) => item.vendorId === mockVendorId);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">{t(realFormal.length ? "formalAvailable" : mockFormal.length ? "mockChannels" : "noneFormal")}</p>
      {intake?.mode === "mock" && (
        <ApplyMockChannelsButton
          label={t("applyMockChannels")}
          pendingLabel={t("mockChannelsPending")}
          doneLabel={t("mockChannelsDone")}
          failedLabel={t("mockChannelsFailed")}
        />
      )}
      {result.items.length === 0 && <p className="text-muted-foreground">{t("empty")}</p>}
      <div className="grid min-w-0 gap-3">
        {result.items.map((item) => (
          <article key={item.channelId} className="min-w-0 space-y-2 rounded-lg border p-3">
            <h3 className="font-medium wrap-anywhere">{item.displayName}</h3>
            <p className="text-muted-foreground">{t(item.kind)} · {t(item.eligibility)}</p>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt>{t("vendor")}</dt><dd className="wrap-anywhere">{item.vendorId}</dd>
              <dt>{t("productEntry")}</dt><dd className="wrap-anywhere">{item.productEntry}</dd>
              <dt>{t("modelVersion")}</dt><dd className="wrap-anywhere">{item.modelVersion}</dd>
              <dt>{t("limits")}</dt><dd className="wrap-anywhere">{item.limitsSummary}</dd>
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

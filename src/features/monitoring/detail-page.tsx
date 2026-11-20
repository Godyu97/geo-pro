import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao";
import { CapabilityRetryButton } from "../capabilities/retry-button";
import { IngestEvidenceButton } from "../evidence/ingest-button";
import { EvidenceDao } from "../evidence/dao";
import { formatMinorUnits } from "./format";
import { RunControls } from "./run-controls";
import { readOwnedRun } from "./service";

export async function generateMetadata() {
  const t = await getTranslator("monitoring");
  return { title: t("detailTitle"), robots: { index: false, follow: false } };
}

export default async function MonitoringRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const session = await requireSession();
  const { runId } = await params;
  const locale = await getLocale();
  const t = await getTranslator("monitoring");
  const te = await getTranslator("evidence");
  const result = await readOwnedRun(session.user.id, runId);
  if (!result) notFound();
  if ("traceId" in result && result.traceId) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{t("unavailable")}</p>
        <CapabilityRetryButton label={t("retry")} />
        <p className="break-all text-muted-foreground">{t("trace", { id: result.traceId })}</p>
      </div>
    );
  }
  const questions = [...new Map(result.slots.map((slot) => [slot.questionId, slot])).values()];
  const payable = result.currency ? formatMinorUnits(locale, result.customerPayableMinor, result.currency) : formatNumber(locale, result.customerPayableMinor);
  const counts = {
    succeeded: result.slots.filter((slot) => slot.status === "succeeded").length,
    failed: result.slots.filter((slot) => slot.status === "failed").length,
    pending: result.slots.filter((slot) => slot.status === "reconciliation_required").length,
    waiting: result.slots.filter((slot) => slot.status === "queued" || slot.status === "paused" || slot.status === "running").length,
    cancelled: result.slots.filter((slot) => slot.status === "cancelled").length,
  };
  const attemptsBySlot = new Map<string, typeof result.attempts>();
  for (const attempt of result.attempts) {
    const list = attemptsBySlot.get(attempt.slotId) ?? [];
    list.push(attempt);
    attemptsBySlot.set(attempt.slotId, list);
  }
  const connection = getConnection();
  const brand = await new BrandDao(connection).active(session.user.id);
  const evidenceDao = new EvidenceDao(connection);
  const evidenceBySlot = new Map<string, string>();
  for (const slot of result.slots) {
    if (slot.status !== "succeeded") continue;
    const observation = await evidenceDao.observationBySlot(session.user.id, result.brandId, slot.id);
    if (observation) evidenceBySlot.set(slot.id, observation.id);
  }
  const statusLabel = {
    queued: "statusQueued", running: "statusRunning", paused: "statusPaused", succeeded: "statusSucceeded",
    partial: "statusPartial", failed: "statusFailed", cancelled: "statusCancelled",
  } as const;
  const slotLabel = {
    queued: "slotQueued", running: "slotRunning", paused: "slotPaused", succeeded: "slotSucceeded",
    failed: "slotFailed", cancelled: "slotCancelled", reconciliation_required: "slotReconciliation",
  } as const;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("detailTitle")}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("detailDescription")}</p>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">{t(statusLabel[result.status])}</dt><dd>{t(result.samplingComplete === 1 ? "samplingComplete" : "samplingIncomplete")}</dd></div>
        <div><dt className="text-muted-foreground">{t("track")}</dt><dd>{t(result.track)}</dd></div>
        <div><dt className="text-muted-foreground">{t("promptSet")}</dt><dd>{t("promptVersion", { version: result.promptSetVersion })}</dd></div>
        <div><dt className="text-muted-foreground">{t("scopeLabel")}</dt><dd>{t("scope", { region: result.region, language: result.language })}</dd></div>
        <div><dt className="text-muted-foreground">{t("customerPayableLabel")}</dt><dd>{payable}</dd></div>
        <div><dt className="text-muted-foreground">{t("created")}</dt><dd>{formatDateTime(locale, new Date(result.createdAt))}</dd></div>
      </dl>
      <p className="text-sm">{t("planned", { count: formatNumber(locale, result.slotCount) })}</p>
      <p className="text-sm">{t("progressCounts", {
        succeeded: formatNumber(locale, counts.succeeded), failed: formatNumber(locale, counts.failed),
        pending: formatNumber(locale, counts.pending), waiting: formatNumber(locale, counts.waiting),
        cancelled: formatNumber(locale, counts.cancelled),
      })}</p>
      <p className="text-sm text-muted-foreground">{t("realChannelClosed")}</p>
      <p className="text-sm text-muted-foreground">{t("isolatedNote")}</p>
      <p className="text-sm">{t("previewSummary", {
        questions: formatNumber(locale, result.questionCount),
        natural: formatNumber(locale, result.naturalCount),
        channels: formatNumber(locale, result.channelCount),
        repeats: formatNumber(locale, result.repeatCount),
        slots: formatNumber(locale, result.slotCount),
      })}</p>
      {result.currency && result.upperMinor !== null && result.estimateHighMinor !== null ? (
        <div className="space-y-1 text-sm">
          <p>{t("trustedCeiling", { amount: formatMinorUnits(locale, result.upperMinor, result.currency) })}</p>
          <p>{t("estimateHigh", { amount: formatMinorUnits(locale, result.estimateHighMinor, result.currency) })}</p>
          <p>{t("estimateLow")}</p>
          <p>{t("reserved", { amount: formatMinorUnits(locale, result.estimateHighMinor, result.currency) })}</p>
          <p>{counts.pending > 0 ? t("actualUnknown") : t("costNone")}</p>
        </div>
      ) : <p className="text-sm">{t("notCharged")}</p>}
      <section className="space-y-2" aria-labelledby="run-questions">
        <h2 id="run-questions" className="font-medium">{t("questions")}</h2>
        <ul className="space-y-2 text-sm">
          {questions.map((slot) => (
            <li key={slot.questionId} className="rounded-lg border p-3">
              <p className="wrap-anywhere">{slot.questionText}</p>
              <p className="text-muted-foreground">{slot.natural === 1 ? t("natural") : t("excluded")}</p>
            </li>
          ))}
        </ul>
      </section>
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-3 font-medium">{t("slot")}</th>
              <th className="py-2 pr-3 font-medium">{t("channels")}</th>
              <th className="py-2 pr-3 font-medium">{t("repeats")}</th>
              <th className="py-2 pr-3 font-medium">{t("reservation")}</th>
              <th className="py-2 font-medium">{t("rawLabel")}</th>
            </tr>
          </thead>
          <tbody>
            {result.slots.map((slot) => {
              const attempts = attemptsBySlot.get(slot.id) ?? [];
              return (
                <tr key={slot.id} className="border-b align-top">
                  <td className="py-2 pr-3 wrap-anywhere">{slot.questionText}</td>
                  <td className="py-2 pr-3">{slot.channelVersion}</td>
                  <td className="py-2 pr-3">{formatNumber(locale, slot.repeatIndex)}</td>
                  <td className="py-2 pr-3 wrap-anywhere">
                    <p>{t(slotLabel[slot.status])}</p>
                    <p>{slot.reservationId ?? t("none")}</p>
                    {slot.late === 1 && <p>{t("lateResult")}</p>}
                  </td>
                  <td className="py-2 wrap-anywhere">
                    {attempts.length === 0 && t("noAttempts")}
                    {attempts.map((attempt) => (
                      <div key={attempt.id} className="mb-2">
                        <p>{t("attemptLabel", { ordinal: formatNumber(locale, attempt.ordinal) })}</p>
                        {attempt.synthetic === 1 && <p>{t("syntheticResult")}</p>}
                        {attempt.late === 1 && <p>{t("lateResult")}</p>}
                        <p>{attempt.actualMinor === null || !result.currency ? attempt.costState === "none" ? t("costNone") : t("actualUnknown") : t("costKnown", { amount: formatMinorUnits(locale, attempt.actualMinor, result.currency) })}</p>
                        {attempt.rawText && <p>{t("rawLabel")}: {attempt.rawText}</p>}
                      </div>
                    ))}
                    {slot.status === "succeeded" && (
                      evidenceBySlot.get(slot.id)
                        ? <Link className="text-sm underline underline-offset-4" href={`/dashboard/monitoring/evidence/${evidenceBySlot.get(slot.id)}`} prefetch={false}>{te("openEvidence")}</Link>
                        : brand && (
                          <IngestEvidenceButton
                            brandId={result.brandId}
                            slotId={slot.id}
                            brandName={brand.name}
                            officialWebsite={null}
                            messages={getMessages(locale).evidence}
                          />
                        )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <RunControls
        runId={result.id}
        messages={getMessages(locale).monitoring}
        succeededSlots={result.slots.filter((slot) => slot.status === "succeeded").map((slot) => ({ id: slot.id, questionText: slot.questionText }))}
        unknownAttempts={result.attempts.filter((attempt) => attempt.kind === "sampling" && attempt.costState === "unknown").map((attempt) => ({
          id: attempt.id,
          questionText: result.slots.find((slot) => slot.id === attempt.slotId)?.questionText ?? attempt.slotId,
        }))}
      />
      <Link className="inline-block text-sm underline underline-offset-4" href="/dashboard/monitoring/new" prefetch={false}>{t("back")}</Link>
    </div>
  );
}

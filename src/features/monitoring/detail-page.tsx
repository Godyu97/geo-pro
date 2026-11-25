import { randomUUID } from "node:crypto";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao";
import { IngestEvidenceButton } from "../evidence/ingest-button";
import { EvidenceDao } from "../evidence/dao";
import { brandIntakeOrigin } from "@/features/brands/intake";
import { ApplyMockEvidenceButton, ExecuteMockRunButton } from "@/features/functional-mock/run-buttons";
import { parseOfficialReceipt } from "@/lib/ai/official-sampling";
import { RunDetailStatus } from "./detail-status";
import { samplingCostMessageKey } from "./failure-contract";
import { formatMinorUnits } from "./format";
import { RunControls } from "./run-controls";
import { readOwnedRun } from "./service";

const panelClass = "min-w-0 space-y-3 rounded-2xl border bg-card p-4 sm:p-5";

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
  const tp = await getTranslator("samplingProtocols");
  const result = await readOwnedRun(session.user.id, runId);
  if (!result) notFound();
  if ("traceId" in result && result.traceId) return <RunDetailStatus state="failed" traceId={result.traceId} />;
  const questions = [...new Map(result.slots.map((slot) => [slot.questionId, slot])).values()];
  const channels = [...new Map(result.slots.map((slot) => [slot.channelId, slot.channelVersion])).entries()];
  const payable = result.currency ? formatMinorUnits(locale, result.customerPayableMinor, result.currency) : formatNumber(locale, result.customerPayableMinor);
  const counts = {
    succeeded: result.slots.filter((slot) => slot.status === "succeeded").length,
    failed: result.slots.filter((slot) => slot.status === "failed").length,
    pending: result.slots.filter((slot) => slot.status === "reconciliation_required").length,
    waiting: result.slots.filter((slot) => slot.status === "queued" || slot.status === "paused" || slot.status === "running").length,
    cancelled: result.slots.filter((slot) => slot.status === "cancelled").length,
  };
  const attemptsBySlot = new Map<string, typeof result.attempts>();
  let knownCost: number | null = null;
  let hasPendingCost = false;
  let hasUnknownCost = false;
  for (const attempt of result.attempts) {
    const list = attemptsBySlot.get(attempt.slotId) ?? [];
    list.push(attempt);
    attemptsBySlot.set(attempt.slotId, list);
    if (attempt.kind !== "sampling") continue;
    if (attempt.costState === "known" && attempt.actualMinor !== null) knownCost = (knownCost ?? 0) + attempt.actualMinor;
    if (attempt.costState === "pending") hasPendingCost = true;
    if (attempt.costState === "unknown") hasUnknownCost = true;
  }
  const mockRun = brandIntakeOrigin(await headers())?.mode === "mock";
  const official = result.track === "model_api" && !mockRun;
  let brand = null;
  const evidenceBySlot = new Map<string, string>();
  try {
    const connection = getConnection();
    if (result.entityVersion !== null) {
      brand = await new BrandDao(connection).version(session.user.id, result.brandId, result.entityVersion);
    }
    const evidenceDao = new EvidenceDao(connection);
    for (const slot of result.slots) {
      if (slot.status !== "succeeded") continue;
      const observation = await evidenceDao.observationBySlot(session.user.id, result.brandId, slot.id);
      if (observation) evidenceBySlot.set(slot.id, observation.id);
    }
  } catch {
    const traceId = randomUUID();
    console.error("monitoring-run-references-unavailable", { traceId });
    return <RunDetailStatus state="failed" traceId={traceId} />;
  }
  const statusLabel = {
    queued: "statusQueued", running: "statusRunning", paused: "statusPaused", succeeded: "statusSucceeded",
    partial: "statusPartial", failed: "statusFailed", cancelled: "statusCancelled",
  } as const;
  const slotLabel = {
    queued: "slotQueued", running: "slotRunning", paused: "slotPaused", succeeded: "slotSucceeded",
    failed: "slotFailed", cancelled: "slotCancelled", reconciliation_required: "slotReconciliation",
  } as const;
  const executePrimary = official && (counts.waiting > 0 || hasPendingCost);
  return (
    <div className="min-w-0 space-y-5">
      <header className="space-y-3">
        <Button asChild variant="outline">
          <Link href={`/dashboard/monitoring/new?brandId=${result.brandId}`} prefetch={false}>{t("back")}</Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{t("detailTitle")}</h1>
      </header>
      <section className={panelClass}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{t(statusLabel[result.status])}</Badge>
          <p className="text-sm text-muted-foreground">{t(result.samplingComplete === 1 ? "samplingComplete" : "samplingIncomplete")}</p>
        </div>
        <p className="text-sm">{t(result.track)}</p>
        <p className="text-sm tabular-nums">{t("planned", { count: formatNumber(locale, result.slotCount) })}</p>
        <p className="text-sm tabular-nums">{t("progressCounts", {
          succeeded: formatNumber(locale, counts.succeeded), failed: formatNumber(locale, counts.failed),
          pending: formatNumber(locale, counts.pending), waiting: formatNumber(locale, counts.waiting),
          cancelled: formatNumber(locale, counts.cancelled),
        })}</p>
        {official ? (
          <p id="official-sampling-note" className="max-w-2xl text-sm leading-6 text-muted-foreground">{t("executeOfficialNote")}</p>
        ) : result.track === "consumer_ui" ? (
          <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("consumerManualNote")}</p>
        ) : null}
        {result.attempts.some((attempt) => attempt.synthetic === 1) && <p className="text-sm text-muted-foreground">{t("isolatedNote")}</p>}
        {hasPendingCost && <p className="max-w-2xl text-sm text-muted-foreground">{t("recoveryNote")}</p>}
        {(hasUnknownCost || hasPendingCost) && (
          <p id="run-cost-notice" role="status" className="max-w-2xl text-sm leading-6">{t("nextStepReconcileCost")}</p>
        )}
        {mockRun && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t("executeMockNote")}</p>
            <ExecuteMockRunButton
              runId={result.id}
              label={t("executeMock")}
              pendingLabel={t("executeMockPending")}
              doneLabel={t("executeMockDone")}
              failedLabel={t("executeMockFailed")}
            />
            <ApplyMockEvidenceButton
              brandId={result.brandId}
              label={te("applyMockEvidence")}
              pendingLabel={te("mockEvidencePending")}
              doneLabel={te("mockEvidenceDone")}
              failedLabel={te("mockEvidenceFailed")}
            />
          </div>
        )}
        <RunControls
          runId={result.id}
          messages={getMessages(locale).monitoring}
          succeededSlots={result.slots.filter((slot) => slot.status === "succeeded").map((slot) => ({ id: slot.id, questionText: slot.questionText }))}
          unknownAttempts={result.attempts.filter((attempt) => attempt.kind === "sampling" && attempt.costState === "unknown").map((attempt) => ({
            id: attempt.id,
            questionText: result.slots.find((slot) => slot.id === attempt.slotId)?.questionText ?? attempt.slotId,
          }))}
          official={official}
          executePrimary={executePrimary}
          mockRun={mockRun}
        />
      </section>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className={panelClass} aria-labelledby="run-scope">
          <h2 id="run-scope" className="font-medium">{t("scopeLabel")}</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">{t("promptSet")}</dt><dd className="wrap-anywhere">{t("frozenPrompt", { id: result.promptSetId, version: formatNumber(locale, result.promptSetVersion) })}</dd></div>
            <div><dt className="text-muted-foreground">{t("samplingTarget")}</dt><dd className="wrap-anywhere">{t("scope", { region: result.region, language: result.language })}</dd></div>
            <div><dt className="text-muted-foreground">{t("network")}</dt><dd>{t(result.requestedNetworkMode === "on" ? "networkOn" : result.requestedNetworkMode === "off" ? "networkOff" : "networkUnknown")}</dd></div>
            <div>
              <dt className="text-muted-foreground">{t("frozenBrandLabel")}</dt>
              <dd className="wrap-anywhere">
                {brand ? (
                  <Link className="underline underline-offset-4" href={`/dashboard/brands/${brand.id}?version=${brand.version}`} prefetch={false}>
                    {t("frozenBrandVersion", { name: brand.fields.name, version: formatNumber(locale, brand.version) })}
                  </Link>
                ) : result.brandId}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{tp("title")}</dt>
              <dd className="wrap-anywhere">
                {result.protocol && <p>{t("frozenProtocol", { id: result.protocol.protocolId, version: formatNumber(locale, result.protocol.version) })}</p>}
                <Link className="underline underline-offset-4" href="/dashboard/monitoring/protocols" prefetch={false}>{tp("pinTitle")}</Link>
              </dd>
            </div>
            <div><dt className="text-muted-foreground">{t("created")}</dt><dd>{formatDateTime(locale, new Date(result.createdAt))}</dd></div>
          </dl>
          <ul className="space-y-1 text-sm">
            {channels.map(([channelId, version]) => (
              <li key={channelId} className="wrap-anywhere">{t("frozenChannel", { id: channelId, version: formatNumber(locale, version) })}</li>
            ))}
          </ul>
          {brand && !brand.fields.website && <p className="text-sm">{t("websiteCitationNa")}</p>}
          <p className="text-sm">{t("previewSummary", {
            questions: formatNumber(locale, result.questionCount),
            natural: formatNumber(locale, result.naturalCount),
            channels: formatNumber(locale, result.channelCount),
            repeats: formatNumber(locale, result.repeatCount),
            slots: formatNumber(locale, result.slotCount),
          })}</p>
        </section>
        <section className={panelClass} aria-labelledby="run-budget">
          <h2 id="run-budget" className="font-medium">{t("runBudget")}</h2>
          <dl className="text-sm">
            <dt className="text-muted-foreground">{t("customerPayableLabel")}</dt>
            <dd className="tabular-nums">{payable}</dd>
          </dl>
          {result.currency && result.upperMinor !== null && result.estimateHighMinor !== null ? (
            <div className="space-y-1 text-sm">
              <p>{t("trustedCeiling", { amount: formatMinorUnits(locale, result.upperMinor, result.currency) })}</p>
              <p>{t("estimateHigh", { amount: formatMinorUnits(locale, result.estimateHighMinor, result.currency) })}</p>
              <p>{t("estimateLow")}</p>
              <p>{t("reserved", { amount: formatMinorUnits(locale, result.estimateHighMinor, result.currency) })}</p>
              {knownCost !== null && <p>{t("costKnown", { amount: formatMinorUnits(locale, knownCost, result.currency) })}</p>}
              {hasPendingCost && <p>{t("costPending")}</p>}
              {hasUnknownCost && <p>{t("actualUnknown")}</p>}
            </div>
          ) : <p className="text-sm">{t("notCharged")}</p>}
        </section>
      </div>
      <section className={panelClass}>
        <h2 id="run-receipts-heading" className="font-medium">{t("runReceipts")}</h2>
        <div
          id="run-receipts" role="region" aria-labelledby="run-receipts-heading" tabIndex={0}
          className="max-w-full scroll-mt-16 overflow-x-auto rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <table className="w-full min-w-[42rem] table-fixed text-left text-sm">
            <thead>
              <tr className="border-b">
                <th scope="col" className="w-1/4 wrap-anywhere py-2 pr-3 font-medium">{t("slot")}</th>
                <th scope="col" className="w-[13%] wrap-anywhere py-2 pr-3 font-medium">{t("channels")}</th>
                <th scope="col" className="w-[11%] wrap-anywhere py-2 pr-3 font-medium">{t("repeats")}</th>
                <th scope="col" className="w-1/5 wrap-anywhere py-2 pr-3 font-medium">{t("reservation")}</th>
                <th scope="col" className="py-2 font-medium">{t("rawLabel")}</th>
              </tr>
            </thead>
            <tbody>
              {result.slots.map((slot) => {
                const attempts = attemptsBySlot.get(slot.id) ?? [];
                return (
                  <tr key={slot.id} className="border-b align-top">
                    <td className="py-2 pr-3 wrap-anywhere">{slot.questionText}</td>
                    <td className="py-2 pr-3">{formatNumber(locale, slot.channelVersion)}</td>
                    <td className="py-2 pr-3">{formatNumber(locale, slot.repeatIndex)}</td>
                    <td className="py-2 pr-3 wrap-anywhere">
                      <p>{t(slotLabel[slot.status])}</p>
                      <p>{slot.reservationId ?? t("none")}</p>
                      {slot.late === 1 && <p>{t("lateResult")}</p>}
                    </td>
                    <td className="py-2 wrap-anywhere">
                      {attempts.length === 0 && t("noAttempts")}
                      {attempts.map((attempt) => {
                        const receipt = parseOfficialReceipt(attempt.receipt);
                        const citationLabel = {
                          complete: "citationComplete", partial: "citationPartial", missing: "citationMissing", unsupported: "citationUnsupported",
                        } as const;
                        const triggerLabel = {
                          triggered: "networkTriggerTriggered", not_triggered: "networkTriggerNotTriggered", unknown: "networkTriggerUnknown",
                        } as const;
                        const costKey = samplingCostMessageKey(attempt.costState, attempt.actualMinor);
                        return (
                          <div key={attempt.id} className="mb-2">
                            <p>{t("attemptLabel", { ordinal: formatNumber(locale, attempt.ordinal) })}</p>
                            {attempt.synthetic === 1 && <p>{t("syntheticResult")}</p>}
                            {attempt.transport === "official_api" && <p>{t("officialAttempt")}</p>}
                            {attempt.late === 1 && <p>{t("lateResult")}</p>}
                            <p>{costKey === "costKnown" && result.currency && attempt.actualMinor !== null
                              ? t("costKnown", { amount: formatMinorUnits(locale, attempt.actualMinor, result.currency) })
                              : t(costKey === "costKnown" ? "actualUnknown" : costKey)}</p>
                            {receipt?.responseId && <p className="break-all">{t("responseLocator", { id: receipt.responseId })}</p>}
                            {receipt && <p>{t(triggerLabel[receipt.networkTrigger])}</p>}
                            {receipt && <p>{t("citationState", { state: t(citationLabel[receipt.citationSetState]) })}</p>}
                            {receipt?.citations.map((citation) => (
                              <p key={`${attempt.id}-${citation.position}`} className="break-all">{t("citationLink", { position: formatNumber(locale, citation.position), url: citation.url })}</p>
                            ))}
                            {attempt.rawText && <p className="whitespace-pre-wrap">{t("rawLabel")}: {attempt.rawText}</p>}
                          </div>
                        );
                      })}
                      {slot.status === "succeeded" && (
                        evidenceBySlot.get(slot.id)
                          ? <Link className="text-sm underline underline-offset-4" href={`/dashboard/monitoring/evidence/${evidenceBySlot.get(slot.id)}`} prefetch={false}>{te("openEvidence")}</Link>
                          : brand && (
                            <IngestEvidenceButton
                              brandId={result.brandId}
                              slotId={slot.id}
                              brandName={brand.fields.name}
                              officialWebsite={brand.fields.website || null}
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
      </section>
      <section className={panelClass} aria-labelledby="run-questions">
        <h2 id="run-questions" className="font-medium">{t("questions")}</h2>
        <ul className="space-y-2 text-sm">
          {questions.map((slot) => (
            <li key={slot.questionId} className="rounded-lg border bg-background p-3">
              <p className="wrap-anywhere">{slot.questionText}</p>
              <p className="text-muted-foreground">{slot.natural === 1 ? t("natural") : t("excluded")}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

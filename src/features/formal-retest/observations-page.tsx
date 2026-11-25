import type { ReactNode } from "react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts";
import { BrandDao } from "../brands/dao";
import { appendFormalConfounderAction, createFormalObservationAction, recordFormalCheckpointAction, registerFormalControlAction } from "./actions";
import { listFormalObservations, type FormalObservationView } from "./commands";

const knownErrors = ["NOT_FOUND", "INVALID_INPUT", "THRESHOLD_REJECTED", "CHECKPOINT_EXISTS"] as const;
const createFormId = "observation-create";
const actionClass = "h-auto max-w-full whitespace-normal";
const inputClass = "h-10 w-full min-w-0 max-w-full rounded-md border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const areaClass = "min-h-24 w-full min-w-0 max-w-full rounded-md border bg-background px-3 py-2 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const relatedClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 break-words whitespace-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const emptyClass = "rounded-2xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground";
const cardClass = "min-w-0 space-y-5 rounded-2xl border bg-card p-5";

type Translate = Awaited<ReturnType<typeof getTranslator<"formalObservations">>>;

function isKnownError(value: string | undefined): value is (typeof knownErrors)[number] {
  return knownErrors.some((code) => code === value);
}

function digits(value: number) {
  return String(value);
}

function formatRatio(value: number | null, naLabel: string) {
  if (value === null) return naLabel;
  return `${(value * 100).toFixed(1)}%`;
}

function reportsHref(brandId?: string) {
  return brandId ? `/dashboard/reports?brandId=${encodeURIComponent(brandId)}` : "/dashboard/reports";
}

function observationsHref(brandId?: string) {
  return brandId ? `/dashboard/reports/observations?brandId=${encodeURIComponent(brandId)}` : "/dashboard/reports/observations";
}

function associated(form?: string) {
  return form ? { form } : {};
}

function nextObservation(observations: readonly FormalObservationView[]) {
  const open = observations.find((item) => {
    const latest = item.checkpoints.at(-1);
    return !latest || latest.mode === "progress";
  });
  if (open) {
    return {
      kind: open.checkpoints.length === 0 ? "pending" as const : "progress" as const,
      observation: open,
    };
  }
  const exploratory = observations.find((item) => item.checkpoints.at(-1)?.mode === "exploratory");
  if (exploratory) return { kind: "exploratory" as const, observation: exploratory };
  const formal = observations.find((item) => item.checkpoints.at(-1)?.mode === "formal");
  if (formal) return { kind: "formal" as const, observation: formal };
  return { kind: "empty" as const, observation: null };
}

function ObservationCanvas({
  title,
  summary,
  primary,
  relatedLabel,
  related,
  children,
}: {
  title: string;
  summary?: ReactNode;
  primary?: ReactNode;
  relatedLabel: string;
  related: ReadonlyArray<{ href: string; label: string }>;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0 max-w-full space-y-8">
      <header className="min-w-0 space-y-3">
        <h1 className="break-words text-2xl font-semibold tracking-tight">{title}</h1>
        {summary}
        {primary}
        {related.length > 0 ? (
          <nav aria-label={relatedLabel} className="flex min-w-0 flex-wrap gap-2">
            {related.map((item) => (
              <Link key={item.href} href={item.href} prefetch={false} className={relatedClass}>
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>
      {children}
    </div>
  );
}

function CreateFields({ t, form }: { t: Translate; form?: string }) {
  return (
    <>
      <h2 className="text-lg font-semibold sm:col-span-2">{t("createTitle")}</h2>
      <label className="min-w-0 space-y-2 text-sm break-words">
        <span>{t("frozenSetId")}</span>
        <input name="frozenSetId" required maxLength={64} className={inputClass} {...associated(form)} />
      </label>
      <label className="min-w-0 space-y-2 text-sm break-words">
        <span>{t("effectiveOn")}</span>
        <input name="effectiveOn" type="date" required className={inputClass} {...associated(form)} />
      </label>
      <label className="min-w-0 space-y-2 text-sm break-words">
        <span>{t("frozenCount")}</span>
        <input name="frozenNonBrandCount" type="number" required min={1} max={500} inputMode="numeric" className={`${inputClass} tabular-nums`} {...associated(form)} />
      </label>
    </>
  );
}

function CheckpointFields({
  t,
  form,
  checkpointLabel,
}: {
  t: Translate;
  form?: string;
  checkpointLabel: { d7: string; d14: string; d28: string };
}) {
  return (
    <>
      <h3 className="text-base font-semibold sm:col-span-2">{t("checkpointTitle")}</h3>
      <label className="min-w-0 space-y-2 text-sm break-words">
        <span>{t("checkpoint")}</span>
        <select name="checkpoint" required className={inputClass} defaultValue="d14" {...associated(form)}>
          <option value="d7">{checkpointLabel.d7}</option>
          <option value="d14">{checkpointLabel.d14}</option>
          <option value="d28">{checkpointLabel.d28}</option>
        </select>
      </label>
      <label className="min-w-0 space-y-2 text-sm break-words">
        <span>{t("today")}</span>
        <input name="today" type="date" required className={inputClass} {...associated(form)} />
        <span className="block text-muted-foreground">{t("todayHint")}</span>
      </label>
    </>
  );
}

export async function generateMetadata() {
  const t = await getTranslator("formalObservations");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function FormalObservationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const t = await getTranslator("formalObservations");
  const errorCode = typeof params.error === "string" ? params.error : undefined;
  const connection = getConnection();
  const requested = typeof params.brandId === "string" ? params.brandId : undefined;
  const parsedBrand = requested ? brandIdSchema.safeParse(requested) : null;
  const active = await new BrandDao(connection).active(session.user.id);
  const brandsAction = (
    <Button asChild className={actionClass}>
      <Link href="/dashboard/brands" prefetch={false}>{t("openBrand")}</Link>
    </Button>
  );
  const related = (brandId?: string) => [{ href: reportsHref(brandId), label: t("backReports") }];

  if (requested && !parsedBrand?.success) {
    return (
      <ObservationCanvas
        title={t("title")}
        summary={<p role="alert" className="max-w-2xl break-words text-sm leading-7">{t("NOT_FOUND")}</p>}
        primary={brandsAction}
        relatedLabel={t("relatedEntries")}
        related={related()}
      />
    );
  }

  const brandId = parsedBrand?.success ? parsedBrand.data : active?.id;
  if (!brandId) {
    return (
      <ObservationCanvas
        title={t("title")}
        summary={<p className="max-w-2xl break-words text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>}
        primary={brandsAction}
        relatedLabel={t("relatedEntries")}
        related={related()}
      />
    );
  }

  const href = observationsHref(brandId);
  const reloadAction = (
    <Button asChild className={actionClass}>
      <a href={href}>{t("reload")}</a>
    </Button>
  );
  let listed: Awaited<ReturnType<typeof listFormalObservations>> | { error: "SERVICE_UNAVAILABLE" };
  try {
    listed = await listFormalObservations(connection, session.user.id, brandId);
  } catch {
    console.error("formal-observations-read-failed", { brandId });
    listed = { error: "SERVICE_UNAVAILABLE" };
  }
  if ("error" in listed && listed.error) {
    const code = listed.error;
    return (
      <ObservationCanvas
        title={t("title")}
        summary={<p role="alert" className="max-w-2xl break-words text-sm leading-7">{t(code)}</p>}
        primary={code === "NOT_FOUND" ? brandsAction : reloadAction}
        relatedLabel={t("relatedEntries")}
        related={related(code === "NOT_FOUND" ? undefined : brandId)}
      />
    );
  }

  const version = active?.id === brandId ? active : await new BrandDao(connection).version(session.user.id, brandId);
  const brandName = version && "name" in version ? version.name : "";
  const observations = listed.observations;
  const next = nextObservation(observations);
  const taskKey = {
    empty: "taskEmpty",
    pending: "taskPending",
    progress: "taskProgress",
    exploratory: "taskExploratory",
    formal: "taskFormal",
  } as const;
  const checkpointFormId = next.observation ? `formal-checkpoint-${next.observation.id}` : "";
  const recordsCheckpoint = next.kind === "pending" || next.kind === "progress";
  const modeLabel = {
    progress: t("modeProgress"),
    formal: t("modeFormal"),
    exploratory: t("modeExploratory"),
  } as const;
  const conclusionLabel = {
    progress: t("conclusionEmpty"),
    formal: t("conclusionFormal"),
    exploratory: t("conclusionExploratory"),
  } as const;
  const checkpointLabel = { d7: t("checkpointD7"), d14: t("checkpointD14"), d28: t("checkpointD28") } as const;
  const factorLabel = { model: t("factorModel"), marketing: t("factorMarketing"), price: t("factorPrice") } as const;
  const statusLabel = { observing: t("statusObserving"), checkpoint_due: t("statusCheckpointDue") } as const;
  const primary = next.kind === "empty" ? (
    <form id={createFormId} action={createFormalObservationAction}>
      <input type="hidden" name="brandId" value={brandId} />
      <Button type="submit" className={actionClass}>{t("create")}</Button>
    </form>
  ) : recordsCheckpoint && next.observation ? (
    <form id={checkpointFormId} action={recordFormalCheckpointAction}>
      <input type="hidden" name="observationId" value={next.observation.id} />
      <Button type="submit" className={actionClass}>{t("requestFormal")}</Button>
    </form>
  ) : next.observation ? (
    <Button asChild className={actionClass}>
      <Link
        href={next.kind === "exploratory" ? `#excluded-${next.observation.id}` : `#history-${next.observation.id}`}
        prefetch={false}
      >
        {next.kind === "exploratory" ? t("viewExcluded") : t("viewHistory")}
      </Link>
    </Button>
  ) : null;

  return (
    <ObservationCanvas
      title={t("title")}
      summary={(
        <div className="max-w-2xl space-y-2">
          {isKnownError(errorCode) ? <p role="alert" className="break-words text-sm leading-7">{t(errorCode)}</p> : null}
          <p role="status" className="break-words text-sm leading-7 text-muted-foreground">{t(taskKey[next.kind])}</p>
          <p className="break-words text-sm leading-7 text-muted-foreground">{t("description")}</p>
        </div>
      )}
      primary={primary}
      relatedLabel={t("relatedEntries")}
      related={related(brandId)}
    >
      {brandName ? <p className="[overflow-wrap:anywhere] text-sm text-muted-foreground">{brandName}</p> : null}

      {next.kind === "empty" ? (
        <div className="grid min-w-0 gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-2">
          <CreateFields t={t} form={createFormId} />
        </div>
      ) : (
        <form action={createFormalObservationAction} className="grid min-w-0 gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-2">
          <input type="hidden" name="brandId" value={brandId} />
          <CreateFields t={t} />
          <div className="flex items-end">
            <Button type="submit" className={actionClass}>{t("create")}</Button>
          </div>
        </form>
      )}

      {observations.length === 0 ? <p className={emptyClass}>{t("empty")}</p> : observations.map((observation) => {
        const checkpointTarget = recordsCheckpoint && next.observation?.id === observation.id;
        const excludedAnchor = observation.checkpoints.findLast((item) => item.mode === "exploratory")?.id;
        return (
          <section key={observation.id} className={cardClass}>
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-3">
              <h2 className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">{observation.frozenSetId}</h2>
              <p className="text-sm">{statusLabel[observation.status]}</p>
            </div>
            <p className="text-sm tabular-nums">{t("effectiveLine", { date: observation.effectiveOn })}</p>
            <p className="text-sm tabular-nums">{t("frozenLine", { count: digits(observation.frozenNonBrandCount) })}</p>

            <div className="min-w-0 space-y-4">
              <h3 className="text-base font-semibold">{t("controlsHeading")}</h3>
              <p className="text-sm leading-7 text-muted-foreground">{t("controlsHint")}</p>
              {observation.checkpoints.length === 0 ? (
                <form action={registerFormalControlAction} className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <input type="hidden" name="observationId" value={observation.id} />
                  <input type="hidden" name="label" value="observation" />
                  <label className="min-w-0 space-y-2 text-sm break-words sm:col-span-2">
                    <span>{t("pageKey")}</span>
                    <input name="pageKey" required maxLength={300} className={inputClass} />
                    <span className="block text-muted-foreground">{t("pageKeyHint")}</span>
                  </label>
                  <div>
                    <Button type="submit" className={actionClass}>{t("saveControl")}</Button>
                  </div>
                </form>
              ) : (
                <p className="text-sm leading-7 text-muted-foreground">{t("controlsClosed")}</p>
              )}
              {observation.controls.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noControls")}</p>
              ) : observation.controls.map((control) => (
                <article key={control.id} className="min-w-0 space-y-2 rounded-xl border border-dashed p-4">
                  <p className="text-sm font-medium">{t("controlLabelObservation")}</p>
                  <p className="text-sm leading-7 [overflow-wrap:anywhere]">{control.pageKey}</p>
                  <p className="text-sm tabular-nums">{t("registeredLine", { time: control.registeredAt })}</p>
                </article>
              ))}
            </div>

            {checkpointTarget ? (
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                <CheckpointFields t={t} form={checkpointFormId} checkpointLabel={checkpointLabel} />
              </div>
            ) : (
              <form action={recordFormalCheckpointAction} className="grid min-w-0 gap-4 sm:grid-cols-2">
                <input type="hidden" name="observationId" value={observation.id} />
                <CheckpointFields t={t} checkpointLabel={checkpointLabel} />
                <div>
                  <Button type="submit" className={actionClass}>{t("requestFormal")}</Button>
                </div>
              </form>
            )}

            <div id={`history-${observation.id}`} className="min-w-0 scroll-mt-28 space-y-3">
              {observation.checkpoints.length === 0 ? null : (
                <>
                  <h3 className="text-base font-semibold">{t("history")}</h3>
                  {observation.checkpoints.map((checkpoint) => {
                    const evaluation = checkpoint.evaluation;
                    return (
                    <article key={checkpoint.id} id={checkpoint.id === excludedAnchor ? `excluded-${observation.id}` : undefined} className="min-w-0 scroll-mt-28 space-y-3 rounded-xl border border-dashed p-4">
                      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-3">
                        <p className="text-sm font-medium">{checkpointLabel[checkpoint.checkpoint]}</p>
                        <p className="text-sm">{modeLabel[checkpoint.mode]}</p>
                      </div>
                      <p className="text-sm tabular-nums">{t("comparableLine", {
                        comparable: digits(checkpoint.comparableCount),
                        frozen: digits(observation.frozenNonBrandCount),
                      })}</p>
                      <p className="text-sm tabular-nums">{t("evaluatedLine", { date: checkpoint.evaluatedOn })}</p>
                      <p className="text-sm leading-7">{conclusionLabel[checkpoint.mode]}</p>
                      {checkpoint.mode !== "progress" && evaluation ? (
                        <div className="space-y-3 border-t pt-3">
                          {evaluation.missingSamples ? (
                            <p className="text-sm leading-7">{t("missingSamplesNotice")}</p>
                          ) : null}
                          <div className="space-y-1">
                            <p className="text-sm font-medium">
                              {t("coverageHeading")} · {evaluation.coverage.passed ? t("gatePassed") : t("gateInsufficient")}
                            </p>
                            <p className="text-sm tabular-nums">{t("coverageWindowLine", {
                              window: t("windowBefore"),
                              eligible: digits(evaluation.coverage.before.eligible),
                              planned: digits(evaluation.coverage.before.planned),
                              rate: formatRatio(evaluation.coverage.before.rate, t("na")),
                            })}</p>
                            <p className="text-sm tabular-nums">{t("coverageWindowLine", {
                              window: t("windowAfter"),
                              eligible: digits(evaluation.coverage.after.eligible),
                              planned: digits(evaluation.coverage.after.planned),
                              rate: formatRatio(evaluation.coverage.after.rate, t("na")),
                            })}</p>
                          </div>
                          <div className="grid min-w-0 gap-3 sm:grid-cols-3">
                            <div className="min-w-0 space-y-1 rounded-lg border p-3">
                              <p className="text-sm font-medium">
                                {t("metricMention")} · {evaluation.metrics.mention.passed ? t("gatePassed") : t("gateInsufficient")}
                              </p>
                              <p className="text-xs tabular-nums text-muted-foreground">{t("metricCommonLine", {
                                comparable: digits(evaluation.metrics.mention.comparableCount),
                                frozen: digits(evaluation.metrics.mention.frozenNonBrandCount),
                              })}</p>
                              <p className="text-xs tabular-nums">{t("metricJudgableLine", {
                                window: t("windowBefore"),
                                symbol: "Jm/E",
                                judged: digits(evaluation.metrics.mention.before.judged),
                                eligible: digits(evaluation.metrics.mention.before.eligible),
                                rate: formatRatio(evaluation.metrics.mention.before.rate, t("na")),
                              })}</p>
                              <p className="text-xs tabular-nums">{t("metricJudgableLine", {
                                window: t("windowAfter"),
                                symbol: "Jm/E",
                                judged: digits(evaluation.metrics.mention.after.judged),
                                eligible: digits(evaluation.metrics.mention.after.eligible),
                                rate: formatRatio(evaluation.metrics.mention.after.rate, t("na")),
                              })}</p>
                            </div>
                            <div className="min-w-0 space-y-1 rounded-lg border p-3">
                              <p className="text-sm font-medium">
                                {t("metricRecommendation")} · {evaluation.metrics.recommendation.passed ? t("gatePassed") : t("gateInsufficient")}
                              </p>
                              <p className="text-xs tabular-nums text-muted-foreground">{t("metricCommonLine", {
                                comparable: digits(evaluation.metrics.recommendation.comparableCount),
                                frozen: digits(evaluation.metrics.recommendation.frozenNonBrandCount),
                              })}</p>
                              <p className="text-xs tabular-nums">{t("metricJudgableLine", {
                                window: t("windowBefore"),
                                symbol: "Jr/E",
                                judged: digits(evaluation.metrics.recommendation.before.judged),
                                eligible: digits(evaluation.metrics.recommendation.before.eligible),
                                rate: formatRatio(evaluation.metrics.recommendation.before.rate, t("na")),
                              })}</p>
                              <p className="text-xs tabular-nums">{t("metricJudgableLine", {
                                window: t("windowAfter"),
                                symbol: "Jr/E",
                                judged: digits(evaluation.metrics.recommendation.after.judged),
                                eligible: digits(evaluation.metrics.recommendation.after.eligible),
                                rate: formatRatio(evaluation.metrics.recommendation.after.rate, t("na")),
                              })}</p>
                            </div>
                            <div className="min-w-0 space-y-1 rounded-lg border p-3">
                              <p className="text-sm font-medium">
                                {t("metricCitation")} · {!evaluation.metrics.citation.applicable
                                  ? t("na")
                                  : evaluation.metrics.citation.passed ? t("gatePassed") : t("gateInsufficient")}
                              </p>
                              <p className="text-xs tabular-nums text-muted-foreground">{t("metricCommonLine", {
                                comparable: digits(evaluation.metrics.citation.comparableCount),
                                frozen: digits(evaluation.metrics.citation.frozenNonBrandCount),
                              })}</p>
                              <p className="text-xs tabular-nums">{t("citationWindowLine", {
                                window: t("windowBefore"),
                                jc: digits(evaluation.metrics.citation.before.judged),
                                c: digits(evaluation.metrics.citation.before.completeCitations),
                                e: digits(evaluation.metrics.citation.before.eligible),
                                jcOverE: formatRatio(evaluation.metrics.citation.before.jcOverE, t("na")),
                                cOverE: formatRatio(evaluation.metrics.citation.before.cOverE, t("na")),
                                jcOverC: formatRatio(evaluation.metrics.citation.before.jcOverC, t("na")),
                              })}</p>
                              <p className="text-xs tabular-nums">{t("citationWindowLine", {
                                window: t("windowAfter"),
                                jc: digits(evaluation.metrics.citation.after.judged),
                                c: digits(evaluation.metrics.citation.after.completeCitations),
                                e: digits(evaluation.metrics.citation.after.eligible),
                                jcOverE: formatRatio(evaluation.metrics.citation.after.jcOverE, t("na")),
                                cOverE: formatRatio(evaluation.metrics.citation.after.cOverE, t("na")),
                                jcOverC: formatRatio(evaluation.metrics.citation.after.jcOverC, t("na")),
                              })}</p>
                            </div>
                          </div>
                          {evaluation.insufficiencyReasons.length > 0 ? (
                            <div className="space-y-1">
                              <p className="text-sm font-medium">{t("insufficientHeading")}</p>
                              <ul className="space-y-1 text-sm">
                                {evaluation.insufficiencyReasons.map((reason) => (
                                  <li key={`${checkpoint.id}-reason-${reason}`} className="break-words">{t(`insufficiency_${reason}`)}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          {evaluation.slotIds.length > 0 ? (
                            <div className="space-y-1">
                              <p className="text-sm font-medium">{t("matchedSlotsHeading", { count: digits(evaluation.slotIds.length) })}</p>
                              <ul className="flex flex-wrap gap-2 text-xs">
                                {evaluation.slotIds.map((slotId) => (
                                  <li key={`${checkpoint.id}-slot-${slotId}`} className="[overflow-wrap:anywhere] tabular-nums">{slotId}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <div>
                        <p className="text-sm font-medium">{t("excludedHeading")}</p>
                        {evaluation && evaluation.excludedQuestions.length > 0 ? (
                          <ul className="mt-1 space-y-1 text-sm">
                            {evaluation.excludedQuestions.map((item) => (
                              <li key={`${checkpoint.id}-ex-${item.questionId}`} className="[overflow-wrap:anywhere] tabular-nums">
                                <span>{item.questionId}</span>
                                <span>{" · "}</span>
                                <span>{item.reasons.map((reason) => t(`exclusion_${reason}`)).join(t("reasonSeparator"))}</span>
                              </li>
                            ))}
                          </ul>
                        ) : checkpoint.excluded.length === 0 ? (
                          <p className="text-sm text-muted-foreground">{t("noExcluded")}</p>
                        ) : (
                          <ul className="mt-1 space-y-1 text-sm">
                            {checkpoint.excluded.map((id, index) => (
                              <li key={`${checkpoint.id}-${index}`} className="[overflow-wrap:anywhere] tabular-nums">{id}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </article>
                    );
                  })}
                </>
              )}
            </div>

            <form action={appendFormalConfounderAction} className="grid min-w-0 gap-4 sm:grid-cols-2">
              <h3 className="text-base font-semibold sm:col-span-2">{t("confounderTitle")}</h3>
              <p className="text-sm leading-7 text-muted-foreground sm:col-span-2">{t("confounderHint")}</p>
              <input type="hidden" name="observationId" value={observation.id} />
              <label className="min-w-0 space-y-2 text-sm break-words">
                <span>{t("factor")}</span>
                <select name="factor" required className={inputClass} defaultValue="model">
                  <option value="model">{factorLabel.model}</option>
                  <option value="marketing">{factorLabel.marketing}</option>
                  <option value="price">{factorLabel.price}</option>
                </select>
              </label>
              <label className="min-w-0 space-y-2 text-sm break-words sm:col-span-2">
                <span>{t("note")}</span>
                <textarea name="note" required maxLength={400} className={areaClass} />
                <span className="block text-muted-foreground">{t("noteHint")}</span>
              </label>
              <div>
                <Button type="submit" className={actionClass}>{t("saveConfounder")}</Button>
              </div>
            </form>

            <div className="min-w-0 space-y-3">
              <h3 className="text-base font-semibold">{t("confoundersHeading")}</h3>
              {observation.confounders.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noConfounders")}</p>
              ) : observation.confounders.map((confounder) => (
                <article key={confounder.id} className="min-w-0 space-y-2 rounded-xl border border-dashed p-4">
                  <p className="text-sm font-medium">{factorLabel[confounder.factor]}</p>
                  <p className="text-sm leading-7 [overflow-wrap:anywhere]">{confounder.note}</p>
                  <p className="text-sm tabular-nums">{t("recordedLine", { time: confounder.recordedAt })}</p>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </ObservationCanvas>
  );
}

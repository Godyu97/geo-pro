"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginPath } from "@/lib/auth/return-to";
import { formatNumber } from "@/lib/i18n/format";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import type { CaptureAttemptView, CapturePromptSet, CaptureSheetView } from "./commands";
import {
  captureCitationUrlSchema,
  captureErrors,
  confirmCaptureAttemptSchema,
  createCaptureSheetSchema,
  degradeCaptureSheetSchema,
  recordCaptureAttemptSchema,
  type CaptureError,
} from "./contracts";

type Copy = Messages["assistedCapture"];
type Translator = (key: keyof Copy, params?: Record<string, string | number>) => string;
type Notice = { kind: "status" | "alert"; text: string };
type BrandSummary = { id: string; name: string; region: string; language: string };

const returnPath = "/dashboard/monitoring/capture";
const credentialPattern = /password|passwd|session[_-]?token|cookie|authorization/i;
const inputClass = "h-10 bg-background";
const textareaClass = "min-h-24 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:opacity-60";
const answerTextareaClass = "min-h-24 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:opacity-60";
const selectClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60";
const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center aria-disabled:opacity-60";
const linkActionClass = "inline-flex min-h-10 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 whitespace-normal [overflow-wrap:anywhere] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function isCaptureError(code: string): code is CaptureError {
  return Object.hasOwn(captureErrors, code);
}

function noticeFrom(payload: unknown, t: Translator): Notice {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return { kind: "alert", text: t("SERVICE_UNAVAILABLE") };
  }
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") {
    return { kind: "alert", text: t("SERVICE_UNAVAILABLE") };
  }
  return { kind: "alert", text: isCaptureError(error.code) ? t(error.code) : t("SERVICE_UNAVAILABLE") };
}

function NoticeBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <p
      role={notice.kind}
      className={notice.kind === "alert"
        ? "rounded-lg border border-destructive/30 bg-card p-3 text-sm leading-6 text-destructive"
        : "rounded-lg border bg-card p-3 text-sm leading-6"}
    >
      {notice.text}
    </p>
  );
}

function parseMinutes(raw: FormDataEntryValue | null) {
  const text = String(raw ?? "").trim();
  if (text.length === 0) return null;
  if (!/^\d{1,6}$/.test(text)) return Number.NaN;
  return Number(text);
}

function parsePromptIds(raw: string) {
  return raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}

function parseCitationLines(raw: string) {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const valid: string[] = [];
  for (const line of lines) {
    const parsed = captureCitationUrlSchema.safeParse(line);
    if (!parsed.success) return { error: true as const, urls: [] as string[] };
    valid.push(parsed.data);
  }
  return { error: false as const, urls: valid };
}

function parseFlag(raw: FormDataEntryValue | null) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

function parseCount(raw: FormDataEntryValue | null) {
  const text = String(raw ?? "").trim();
  if (!/^\d{1,4}$/.test(text)) return Number.NaN;
  return Number(text);
}

function attemptBadgeVariant(status: CaptureAttemptView["status"]) {
  if (status === "handoff") return "destructive" as const;
  if (status === "partial") return "secondary" as const;
  return "outline" as const;
}

export function CapturePanel({
  brand,
  canWrite,
  promptSets,
  sheets,
  initialError,
  messages,
}: {
  brand: BrandSummary;
  canWrite: boolean;
  promptSets: CapturePromptSet[];
  sheets: CaptureSheetView[];
  initialError?: CaptureError | null;
  messages: Copy;
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const manualEntryHref = `/dashboard/monitoring/answers?brandId=${encodeURIComponent(brand.id)}&sourceMode=consumer_ui#manual-evidence-form`;

  const questionTextById = new Map<string, string>();
  for (const set of promptSets) {
    for (const question of set.questions) {
      if (!questionTextById.has(question.id)) {
        questionTextById.set(question.id, question.text);
      }
    }
  }

  const modeLabel: Record<CaptureSheetView["mode"], string> = {
    assisted: t("modeAssisted"),
    manual: t("modeManual"),
  };
  const statusLabel: Record<CaptureAttemptView["status"], string> = {
    handoff: t("statusHandoff"),
    partial: t("statusPartial"),
    preview: t("statusPreview"),
  };
  const note: Record<CaptureAttemptView["status"], string> = {
    handoff: t("handoffNote"),
    partial: t("partialNote"),
    preview: t("previewNote"),
  };

  return (
    <div className="min-w-0 space-y-6">
      {initialError ? (
        <NoticeBanner notice={{ kind: "alert", text: t(initialError) }} />
      ) : null}

      {!canWrite ? (
        <NoticeBanner notice={{ kind: "status", text: t("readOnlyNotice") }} />
      ) : (
        <CreateSheetForm brandId={brand.id} promptSets={promptSets} locale={locale} t={t} />
      )}

      <section aria-labelledby="capture-sheets" className="min-w-0 space-y-4">
        <h2
          id="capture-sheets"
          tabIndex={-1}
          className="scroll-mt-24 rounded-sm text-lg font-semibold focus-visible:outline-2 focus-visible:outline-ring"
        >
          {t("sheetsHeading")}
        </h2>

        {sheets.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <ul className="space-y-4">
            {sheets.map((sheet) => (
              <CaptureSheetCard
                key={sheet.id}
                brand={brand}
                canWrite={canWrite}
                sheet={sheet}
                questionTextById={questionTextById}
                manualEntryHref={manualEntryHref}
                locale={locale}
                when={when}
                modeLabel={modeLabel}
                statusLabel={statusLabel}
                note={note}
                t={t}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CaptureSheetCard({
  brand,
  canWrite,
  sheet,
  questionTextById,
  manualEntryHref,
  locale,
  when,
  modeLabel,
  statusLabel,
  note,
  t,
}: {
  brand: BrandSummary;
  canWrite: boolean;
  sheet: CaptureSheetView;
  questionTextById: ReadonlyMap<string, string>;
  manualEntryHref: string;
  locale: ReturnType<typeof useLocale>["locale"];
  when: Intl.DateTimeFormat;
  modeLabel: Record<CaptureSheetView["mode"], string>;
  statusLabel: Record<CaptureAttemptView["status"], string>;
  note: Record<CaptureAttemptView["status"], string>;
  t: Translator;
}) {
  const [degradeNotice, setDegradeNotice] = useState<Notice | null>(null);
  const [confirmedIds, setConfirmedIds] = useState<Record<string, boolean>>({});

  return (
    <li>
      <Card size="sm" className="min-w-0">
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{modeLabel[sheet.mode]}</h3>
              <Badge variant={sheet.mode === "assisted" ? "default" : "secondary"}>
                {modeLabel[sheet.mode]}
              </Badge>
              <Badge variant="outline">
                {sheet.citationsComplete ? t("citationsCompleteYes") : t("citationsCompleteNo")}
              </Badge>
            </div>
            <p className="text-sm tabular-nums">
              {sheet.savedMinutes === null
                ? t("savedMinutesEmpty")
                : t("savedMinutesLine", { minutes: formatNumber(locale, sheet.savedMinutes) })}
            </p>
          </div>

          <dl className="grid gap-3 text-sm leading-6 sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t("citationsComplete")}</dt>
              <dd>{sheet.citationsComplete ? t("citationsCompleteYes") : t("citationsCompleteNo")}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t("assistedMinutes")}</dt>
              <dd className="tabular-nums">
                {sheet.assistedMinutes === null ? "—" : formatNumber(locale, sheet.assistedMinutes)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t("manualMinutes")}</dt>
              <dd className="tabular-nums">
                {sheet.manualMinutes === null ? "—" : formatNumber(locale, sheet.manualMinutes)}
              </dd>
            </div>
          </dl>

          <p className="text-xs text-muted-foreground">
            {t("createdAt", { time: when.format(new Date(sheet.createdAt)) })}
            {" · "}
            {t("switchedAccountNo")} {t("manualStillAvailable")}
          </p>

          <div className="space-y-2">
            <h4 className="text-sm font-semibold">{t("promptHeading")}</h4>
            <ul className="space-y-2">
              {sheet.promptIds.map((id) => {
                const text = questionTextById.get(id);
                return (
                  <li
                    key={id}
                    className="space-y-1 rounded-lg border border-dashed bg-muted/20 px-3 py-2 [overflow-wrap:anywhere]"
                  >
                    {text ? <p className="text-sm leading-6 [overflow-wrap:anywhere]">{text}</p> : null}
                    <code className="block font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{id}</code>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold">{t("attemptsHeading")}</h4>
            {sheet.attempts.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
                {t("noAttempts")}
              </p>
            ) : (
              <ul className="space-y-3">
                {sheet.attempts.map((attempt) => {
                  const resolvedQuestion = attempt.questionText
                    || (attempt.promptId ? questionTextById.get(attempt.promptId) : null);
                  return (
                    <li key={attempt.id} className="min-w-0 space-y-2.5 rounded-xl border bg-muted/30 p-4 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={attemptBadgeVariant(attempt.status)}>
                          {statusLabel[attempt.status]}
                        </Badge>
                        <Badge variant={attempt.complete ? "default" : "outline"}>
                          {attempt.complete ? t("completeYes") : t("completeNo")}
                        </Badge>
                        <Badge variant={attempt.saved ? "secondary" : "outline"}>
                          {attempt.saved ? t("savedYes") : t("savedNo")}
                        </Badge>
                        {attempt.observationState ? (
                          <Badge variant={attempt.observationState === "draft_evidence" ? "secondary" : "default"}>
                            {attempt.observationState === "draft_evidence"
                              ? t("evidenceStateDraft")
                              : attempt.observationState === "contested"
                                ? t("evidenceStateContested")
                                : t("evidenceStateComplete")}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="leading-6">{note[attempt.status]}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {attempt.blockedBy === "captcha"
                          ? t("blockedCaptcha")
                          : attempt.blockedBy === "login"
                            ? t("blockedLogin")
                            : t("blockedNone")}
                        {" · "}
                        {t("citationCount")} {formatNumber(locale, attempt.citationCount)}
                        {attempt.citationSetState ? ` · ${attempt.citationSetState}` : ""}
                      </p>
                      {resolvedQuestion ? (
                        <p className="text-xs leading-5 [overflow-wrap:anywhere]">
                          <span className="font-medium">{t("previewQuestionLabel")}</span> {resolvedQuestion}
                        </p>
                      ) : null}
                      {attempt.answerText ? (
                        <div className="space-y-1 rounded-lg border bg-background/80 p-2.5 text-xs leading-5">
                          <p className="font-medium text-muted-foreground">{t("previewAnswerLabel")}</p>
                          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{attempt.answerText}</p>
                        </div>
                      ) : null}
                      {attempt.citations.length > 0 ? (
                        <div className="space-y-1 text-xs">
                          <p className="font-medium text-muted-foreground">{t("previewCitationsLabel")}</p>
                          <ul className="list-disc space-y-0.5 pl-4 font-mono">
                            {attempt.citations.map((url) => (
                              <li key={url} className="[overflow-wrap:anywhere]">{url}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {attempt.locatorRef || attempt.collectorId ? (
                        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                          {attempt.collectorId ? `${t("previewCollectorLabel")} ${attempt.collectorId}` : ""}
                          {attempt.collectorId && attempt.locatorRef ? " · " : ""}
                          {attempt.locatorRef ? `${t("previewLocatorLabel")} ${attempt.locatorRef}` : ""}
                        </p>
                      ) : null}
                      {confirmedIds[attempt.id] ? (
                        <NoticeBanner notice={{ kind: "status", text: t("confirmedSaved") }} />
                      ) : null}
                      {attempt.status === "handoff" ? (
                        <div className="space-y-2 pt-1">
                          <p className="text-xs text-muted-foreground">{t("confirmHint")}</p>
                          <Link href={manualEntryHref} prefetch={false} className={linkActionClass}>
                            {t("openManualEntry")}
                          </Link>
                        </div>
                      ) : !attempt.confirmed && canWrite ? (
                        <ConfirmAttemptForm
                          attempt={attempt}
                          manualEntryHref={manualEntryHref}
                          t={t}
                          onConfirmed={() => setConfirmedIds((prev) => ({ ...prev, [attempt.id]: true }))}
                        />
                      ) : null}
                      {attempt.observationId ? (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button asChild variant="outline" className={actionClass}>
                            <Link
                              href={`/dashboard/monitoring/evidence/${attempt.observationId}?brandId=${encodeURIComponent(brand.id)}&sourceMode=consumer_ui`}
                              prefetch={false}
                            >
                              {attempt.observationState === "draft_evidence"
                                ? t("completeDraftDetail")
                                : t("openEvidenceDetail")}
                            </Link>
                          </Button>
                          {attempt.observationState !== "draft_evidence" ? (
                            <Button asChild variant="outline" className={actionClass}>
                              <Link
                                href={`/dashboard/monitoring/answers?brandId=${encodeURIComponent(brand.id)}&sourceMode=consumer_ui#answer-${attempt.observationId}`}
                                prefetch={false}
                              >
                                {t("openInConsumerAnswers")}
                              </Link>
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {canWrite ? (
            <div className="grid gap-4 border-t pt-4 lg:grid-cols-2">
              <RecordAttemptForm
                brand={brand}
                sheetId={sheet.id}
                promptIds={sheet.promptIds}
                questionTextById={questionTextById}
                manualEntryHref={manualEntryHref}
                t={t}
              />
              {sheet.mode === "assisted" ? (
                <DegradeSheetForm sheetId={sheet.id} t={t} notice={degradeNotice} onNotice={setDegradeNotice} />
              ) : (
                <div className="space-y-3 rounded-xl border border-dashed bg-muted/20 p-4 text-sm">
                  <h4 className="font-semibold">{t("degradeTitle")}</h4>
                  <NoticeBanner notice={degradeNotice} />
                  <p className="leading-6 text-muted-foreground">{t("manualActiveNote")}</p>
                  <Link href={manualEntryHref} prefetch={false} className={linkActionClass}>
                    {t("openManualEntry")}
                  </Link>
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </li>
  );
}

function CreateSheetForm({
  brandId,
  promptSets,
  locale,
  t,
}: {
  brandId: string;
  promptSets: CapturePromptSet[];
  locale: ReturnType<typeof useLocale>["locale"];
  t: Translator;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [selectedSetId, setSelectedSetId] = useState(promptSets[0]?.id ?? "");
  const [promptIdsText, setPromptIdsText] = useState("");
  const currentSet = promptSets.find((item) => item.id === selectedSetId) ?? promptSets[0] ?? null;
  const currentIds = parsePromptIds(promptIdsText);

  function toggleQuestion(questionId: string, checked: boolean) {
    const existing = parsePromptIds(promptIdsText);
    const next = checked
      ? (existing.includes(questionId) ? existing : [...existing, questionId])
      : existing.filter((id) => id !== questionId);
    setPromptIdsText(next.join("\n"));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = createCaptureSheetSchema.safeParse({
      brandId,
      promptIds: parsePromptIds(String(data.get("promptIds") ?? "")),
      assistedMinutes: parseMinutes(data.get("assistedMinutes")),
      manualMinutes: parseMinutes(data.get("manualMinutes")),
      citationsComplete: parseFlag(data.get("citationsComplete")),
    });
    if (!parsed.success) {
      setNotice({ kind: "alert", text: t("INVALID_INPUT") });
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/monitoring/capture/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath(returnPath, "session-required"));
          return;
        }
        setNotice(noticeFrom(await response.json(), t));
        return;
      }
      setNotice({ kind: "status", text: t("sheetSaved") });
      setPromptIdsText("");
      form.reset();
      router.refresh();
    } catch {
      setNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="min-w-0 max-w-3xl">
      <CardContent>
        <form onSubmit={submit} noValidate className="grid min-w-0 gap-4 sm:grid-cols-2">
          <h2
            id="capture-create-heading"
            tabIndex={-1}
            className="scroll-mt-24 text-base font-semibold focus-visible:outline-2 focus-visible:outline-ring sm:col-span-2"
          >
            {t("createTitle")}
          </h2>
          <div className="sm:col-span-2">
            <NoticeBanner notice={notice} />
          </div>
          {promptSets.length > 0 && currentSet ? (
            <div className="min-w-0 space-y-2 rounded-xl border bg-muted/20 p-3 sm:col-span-2">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="capture-prompt-set">{t("promptSetSelect")}</Label>
                <select
                  id="capture-prompt-set"
                  value={currentSet.id}
                  disabled={pending}
                  onChange={(event) => setSelectedSetId(event.target.value)}
                  className={selectClass}
                >
                  {promptSets.map((set) => (
                    <option key={set.id} value={set.id}>
                      {t("promptSetOption", { version: formatNumber(locale, set.version) })}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 pt-1">
                {currentSet.questions.map((question) => {
                  const checked = currentIds.includes(question.id);
                  return (
                    <label
                      key={question.id}
                      className="flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 text-sm has-checked:bg-muted/70"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={pending}
                        onChange={(event) => toggleQuestion(question.id, event.target.checked)}
                        className="mt-1 size-4 shrink-0 accent-primary focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <span className="min-w-0 space-y-0.5">
                        <span className="block [overflow-wrap:anywhere]">{question.text}</span>
                        <span className="block font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                          {question.id}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
              {t("noPromptSets")}{" "}
              <Link href="/dashboard/brands/questions" prefetch={false} className="underline underline-offset-4">
                {t("openQuestions")}
              </Link>
            </p>
          )}
          <div className="min-w-0 space-y-1.5 sm:col-span-2">
            <Label htmlFor="capture-prompt-ids">{t("promptIds")}</Label>
            <textarea
              id="capture-prompt-ids"
              name="promptIds"
              required
              rows={4}
              maxLength={8000}
              autoComplete="off"
              spellCheck={false}
              readOnly={pending}
              value={promptIdsText}
              onChange={(event) => setPromptIdsText(event.target.value)}
              aria-describedby="capture-prompt-ids-hint"
              className={textareaClass}
            />
            <p id="capture-prompt-ids-hint" className="text-xs text-muted-foreground">{t("promptIdsHint")}</p>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="capture-assisted-minutes">{t("assistedMinutes")}</Label>
            <Input
              id="capture-assisted-minutes"
              name="assistedMinutes"
              inputMode="numeric"
              maxLength={6}
              autoComplete="off"
              spellCheck={false}
              readOnly={pending}
              aria-describedby="capture-assisted-minutes-hint"
              className={`${inputClass} tabular-nums`}
            />
            <p id="capture-assisted-minutes-hint" className="text-xs text-muted-foreground">{t("assistedMinutesHint")}</p>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="capture-manual-minutes">{t("manualMinutes")}</Label>
            <Input
              id="capture-manual-minutes"
              name="manualMinutes"
              inputMode="numeric"
              maxLength={6}
              autoComplete="off"
              spellCheck={false}
              readOnly={pending}
              aria-describedby="capture-manual-minutes-hint"
              className={`${inputClass} tabular-nums`}
            />
            <p id="capture-manual-minutes-hint" className="text-xs text-muted-foreground">{t("manualMinutesHint")}</p>
          </div>
          <div className="min-w-0 space-y-1.5 sm:col-span-2">
            <Label htmlFor="capture-citations-complete">{t("citationsComplete")}</Label>
            <select
              id="capture-citations-complete"
              name="citationsComplete"
              required
              defaultValue="false"
              disabled={pending}
              className={selectClass}
            >
              <option value="true">{t("citationsCompleteYes")}</option>
              <option value="false">{t("citationsCompleteNo")}</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" aria-disabled={pending} className={actionClass}>
              {pending ? t("creating") : t("create")}
            </Button>
            <p role="status" className="sr-only">{pending ? t("creating") : ""}</p>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function RecordAttemptForm({
  brand,
  sheetId,
  promptIds,
  questionTextById,
  manualEntryHref,
  t,
}: {
  brand: BrandSummary;
  sheetId: string;
  promptIds: string[];
  questionTextById: ReadonlyMap<string, string>;
  manualEntryHref: string;
  t: Translator;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [blockedValue, setBlockedValue] = useState("");
  const [citationUrls, setCitationUrls] = useState("");
  const [citationCountText, setCitationCountText] = useState("0");
  const promptSelectId = `capture-prompt-${sheetId}`;
  const blockId = `capture-blocked-${sheetId}`;
  const citationId = `capture-citations-${sheetId}`;
  const citationHintId = `capture-citations-hint-${sheetId}`;
  const answerId = `capture-answer-${sheetId}`;
  const citationUrlsId = `capture-citation-urls-${sheetId}`;
  const citationStateId = `capture-citation-state-${sheetId}`;
  const locatorId = `capture-locator-${sheetId}`;
  const collectorFieldId = `capture-collector-${sheetId}`;
  const targetRegionId = `capture-target-region-${sheetId}`;
  const observedRegionId = `capture-observed-region-${sheetId}`;
  const networkId = `capture-network-${sheetId}`;
  const newSessionId = `capture-session-${sheetId}`;
  const productModeId = `capture-product-mode-${sheetId}`;

  function handleCitationUrlsChange(next: string) {
    setCitationUrls(next);
    const nonEmptyCount = next.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
    setCitationCountText(String(nonEmptyCount));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const rawBlock = String(data.get("blockedBy") ?? "");
    const rawPromptId = String(data.get("promptId") ?? "").trim();
    const rawAnswer = String(data.get("answerText") ?? "");
    const rawLocator = String(data.get("locatorRef") ?? "").trim();
    const rawCollector = String(data.get("collectorId") ?? "").trim();
    const rawCitationState = String(data.get("citationSetState") ?? "").trim();
    const rawTargetRegion = String(data.get("targetRegion") ?? "").trim();
    const rawObservedRegion = String(data.get("observedRegion") ?? "").trim();
    const rawNetwork = String(data.get("requestedNetworkMode") ?? "").trim();
    const rawNewSession = String(data.get("newSession") ?? "").trim();
    const rawProductMode = String(data.get("productMode") ?? "").trim();

    if (
      credentialPattern.test(rawAnswer)
      || credentialPattern.test(rawLocator)
      || credentialPattern.test(rawCollector)
    ) {
      setNotice({ kind: "alert", text: t("credentialRejected") });
      return;
    }

    const parsedUrls = parseCitationLines(citationUrls);
    if (parsedUrls.error) {
      setNotice({ kind: "alert", text: t("invalidCitationUrl") });
      return;
    }

    const countValue = parseCount(data.get("citationCount"));
    const payload: Record<string, unknown> = {
      sheetId,
      blockedBy: rawBlock.length === 0 ? null : rawBlock,
      citationCount: parsedUrls.urls.length > 0 ? Math.max(countValue || 0, parsedUrls.urls.length) : countValue,
    };
    if (rawPromptId) payload.promptId = rawPromptId;
    if (rawAnswer.trim().length > 0) payload.answerText = rawAnswer;
    if (parsedUrls.urls.length > 0) payload.citations = parsedUrls.urls;
    if (rawCitationState) payload.citationSetState = rawCitationState;
    if (rawLocator) payload.locatorRef = rawLocator;
    if (rawCollector) payload.collectorId = rawCollector;
    if (rawAnswer.trim().length > 0) {
      if (rawNetwork) payload.requestedNetworkMode = rawNetwork;
      if (rawTargetRegion) payload.targetRegion = rawTargetRegion;
      if (rawObservedRegion) payload.observedRegion = rawObservedRegion;
      if (rawNewSession) payload.newSession = rawNewSession;
      if (rawProductMode) payload.productMode = rawProductMode;
    }

    const parsed = recordCaptureAttemptSchema.safeParse(payload);
    if (!parsed.success) {
      setNotice({ kind: "alert", text: t("INVALID_INPUT") });
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/monitoring/capture/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath(returnPath, "session-required"));
          return;
        }
        setNotice(noticeFrom(await response.json(), t));
        return;
      }
      setNotice({ kind: "status", text: t("attemptSaved") });
      setBlockedValue("");
      setCitationUrls("");
      setCitationCountText("0");
      form.reset();
      router.refresh();
    } catch {
      setNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid min-w-0 gap-3 rounded-xl border bg-muted/10 p-4">
      <h4 className="text-sm font-semibold">{t("attemptTitle")}</h4>
      <NoticeBanner notice={notice} />
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={promptSelectId}>{t("promptSelectLabel")}</Label>
        <select id={promptSelectId} name="promptId" defaultValue={promptIds[0] ?? ""} disabled={pending} className={selectClass}>
          <option value="">{t("promptSelectPlaceholder")}</option>
          {promptIds.map((id) => {
            const text = questionTextById.get(id);
            return (
              <option key={id} value={id}>
                {text ? `${text} (${id.slice(0, 8)})` : `#${id.slice(0, 8)}`}
              </option>
            );
          })}
        </select>
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={blockId}>{t("blockedBy")}</Label>
        <select
          id={blockId}
          name="blockedBy"
          value={blockedValue}
          disabled={pending}
          onChange={(event) => setBlockedValue(event.target.value)}
          className={selectClass}
        >
          <option value="">{t("blockedNone")}</option>
          <option value="captcha">{t("blockedCaptcha")}</option>
          <option value="login">{t("blockedLogin")}</option>
        </select>
      </div>
      {blockedValue ? (
        <div className="space-y-2 rounded-lg border border-dashed bg-card p-3 text-xs">
          <p className="leading-5 text-muted-foreground">{t("handoffNote")}</p>
          <Link href={manualEntryHref} prefetch={false} className={linkActionClass}>
            {t("openManualEntry")}
          </Link>
        </div>
      ) : null}
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={answerId}>{t("answerText")}</Label>
        <textarea
          id={answerId}
          name="answerText"
          rows={3}
          maxLength={8000}
          readOnly={pending}
          className={answerTextareaClass}
        />
        <p className="text-xs text-muted-foreground">{t("answerTextHint")}</p>
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={citationUrlsId}>{t("citationUrls")}</Label>
        <textarea
          id={citationUrlsId}
          name="citationUrls"
          rows={2}
          maxLength={4000}
          spellCheck={false}
          readOnly={pending}
          value={citationUrls}
          onChange={(event) => handleCitationUrlsChange(event.target.value)}
          className={textareaClass}
        />
        <p className="text-xs text-muted-foreground">{t("citationUrlsHint")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={citationId}>{t("citationCount")}</Label>
          <Input
            id={citationId}
            name="citationCount"
            required
            inputMode="numeric"
            maxLength={4}
            value={citationCountText}
            onChange={(event) => setCitationCountText(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            readOnly={pending}
            aria-describedby={citationHintId}
            className={`${inputClass} tabular-nums`}
          />
          <p id={citationHintId} className="text-xs text-muted-foreground">{t("citationCountHint")}</p>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={citationStateId}>{t("citationSetState")}</Label>
          <select id={citationStateId} name="citationSetState" defaultValue="" disabled={pending} className={selectClass}>
            <option value="">{t("promptSelectPlaceholder")}</option>
            <option value="complete">{t("citationStateComplete")}</option>
            <option value="partial">{t("citationStatePartial")}</option>
            <option value="unsupported">{t("citationStateUnsupported")}</option>
            <option value="missing">{t("citationStateMissing")}</option>
          </select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={collectorFieldId}>{t("collectorId")}</Label>
          <Input
            id={collectorFieldId}
            name="collectorId"
            maxLength={128}
            autoComplete="off"
            spellCheck={false}
            readOnly={pending}
            className={inputClass}
          />
          <p className="text-xs text-muted-foreground">{t("collectorIdHint")}</p>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={locatorId}>{t("locatorRef")}</Label>
          <Input
            id={locatorId}
            name="locatorRef"
            maxLength={500}
            autoComplete="off"
            spellCheck={false}
            readOnly={pending}
            className={inputClass}
          />
          <p className="text-xs text-muted-foreground">{t("locatorRefHint")}</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={targetRegionId}>{t("targetRegion")}</Label>
          <Input
            id={targetRegionId}
            name="targetRegion"
            defaultValue={brand.region}
            maxLength={2}
            autoComplete="off"
            readOnly={pending}
            className={inputClass}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={observedRegionId}>{t("observedRegion")}</Label>
          <Input
            id={observedRegionId}
            name="observedRegion"
            defaultValue="unknown"
            maxLength={7}
            autoComplete="off"
            readOnly={pending}
            className={inputClass}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={networkId}>{t("requestedNetworkMode")}</Label>
          <select id={networkId} name="requestedNetworkMode" defaultValue="unknown" disabled={pending} className={selectClass}>
            <option value="unknown">{t("networkUnknown")}</option>
            <option value="on">{t("networkOn")}</option>
            <option value="off">{t("networkOff")}</option>
          </select>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={newSessionId}>{t("newSession")}</Label>
          <select id={newSessionId} name="newSession" defaultValue="unknown" disabled={pending} className={selectClass}>
            <option value="unknown">{t("triUnknown")}</option>
            <option value="true">{t("triTrue")}</option>
            <option value="false">{t("triFalse")}</option>
          </select>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={productModeId}>{t("productMode")}</Label>
          <select id={productModeId} name="productMode" defaultValue="unknown" disabled={pending} className={selectClass}>
            <option value="unknown">{t("triUnknown")}</option>
            <option value="true">{t("triTrue")}</option>
            <option value="false">{t("triFalse")}</option>
          </select>
        </div>
      </div>
      <div>
        <Button type="submit" aria-disabled={pending} className={actionClass}>
          {pending ? t("recording") : t("recordAttempt")}
        </Button>
      </div>
    </form>
  );
}

function ConfirmAttemptForm({
  attempt,
  manualEntryHref,
  t,
  onConfirmed,
}: {
  attempt: CaptureAttemptView;
  manualEntryHref: string;
  t: Translator;
  onConfirmed: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [supplementUrls, setSupplementUrls] = useState("");
  const supplementId = `capture-supplement-urls-${attempt.id}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const parsedUrls = parseCitationLines(supplementUrls);
    if (parsedUrls.error) {
      setNotice({ kind: "alert", text: t("invalidCitationUrl") });
      return;
    }

    const payload: Record<string, unknown> = { confirmed: true };
    if (parsedUrls.urls.length > 0) {
      payload.citations = parsedUrls.urls;
      payload.citationSetState = "complete";
    }

    const parsed = confirmCaptureAttemptSchema.safeParse(payload);
    if (!parsed.success) {
      setNotice({ kind: "alert", text: t("INVALID_INPUT") });
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/monitoring/capture/attempts/${encodeURIComponent(attempt.id)}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath(returnPath, "session-required"));
          return;
        }
        setNotice(noticeFrom(await response.json(), t));
        return;
      }
      onConfirmed();
      router.refresh();
    } catch {
      setNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2.5 pt-1">
      <NoticeBanner notice={notice} />
      {attempt.status === "partial" ? (
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={supplementId}>{t("supplementCitations")}</Label>
          <textarea
            id={supplementId}
            rows={2}
            maxLength={4000}
            spellCheck={false}
            readOnly={pending}
            value={supplementUrls}
            onChange={(event) => setSupplementUrls(event.target.value)}
            className={textareaClass}
          />
          <p className="text-xs text-muted-foreground">{t("supplementCitationsHint")}</p>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("confirmHint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="outline" aria-disabled={pending} className={actionClass}>
          {pending ? t("confirming") : t("confirm")}
        </Button>
        <Link href={manualEntryHref} prefetch={false} className={linkActionClass}>
          {t("openManualEntry")}
        </Link>
      </div>
    </form>
  );
}

function DegradeSheetForm({
  sheetId,
  t,
  notice,
  onNotice,
}: {
  sheetId: string;
  t: Translator;
  notice: Notice | null;
  onNotice: (next: Notice | null) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const selectId = `capture-degrade-${sheetId}`;
  const hintId = `capture-degrade-hint-${sheetId}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = degradeCaptureSheetSchema.safeParse({
      structureChanged: parseFlag(data.get("structureChanged")),
    });
    if (!parsed.success) {
      onNotice({ kind: "alert", text: t("INVALID_INPUT") });
      return;
    }
    setPending(true);
    onNotice(null);
    try {
      const response = await fetch(`/api/monitoring/capture/sheets/${encodeURIComponent(sheetId)}/degrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath(returnPath, "session-required"));
          return;
        }
        onNotice(noticeFrom(await response.json(), t));
        return;
      }
      onNotice({ kind: "status", text: t("modeUpdated") });
      router.refresh();
    } catch {
      onNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid min-w-0 gap-3 rounded-xl border bg-muted/10 p-4">
      <h4 className="text-sm font-semibold">{t("degradeTitle")}</h4>
      <NoticeBanner notice={notice} />
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={selectId}>{t("structureChanged")}</Label>
        <select
          id={selectId}
          name="structureChanged"
          required
          defaultValue="false"
          disabled={pending}
          aria-describedby={hintId}
          className={selectClass}
        >
          <option value="true">{t("structureChangedYes")}</option>
          <option value="false">{t("structureChangedNo")}</option>
        </select>
        <p id={hintId} className="text-xs text-muted-foreground">{t("degradeHint")}</p>
      </div>
      <div>
        <Button type="submit" variant="outline" aria-disabled={pending} className={actionClass}>
          {pending ? t("degrading") : t("degrade")}
        </Button>
      </div>
    </form>
  );
}

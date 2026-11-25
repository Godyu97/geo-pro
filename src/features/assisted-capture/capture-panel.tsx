"use client";

import { useState, type FormEvent } from "react";
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
import type { CaptureAttemptView, CaptureSheetView } from "./commands";
import {
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

const returnPath = "/dashboard/monitoring/capture";
const inputClass = "h-10 bg-background";
const textareaClass = "min-h-24 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:opacity-60";
const selectClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60";
const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center aria-disabled:opacity-60";

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

function parsePromptIds(raw: FormDataEntryValue | null) {
  return String(raw ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
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
  brandId,
  sheets,
  initialError,
  messages,
}: {
  brandId: string;
  sheets: CaptureSheetView[];
  initialError?: CaptureError | null;
  messages: Copy;
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

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

      <CreateSheetForm brandId={brandId} t={t} />

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
                sheet={sheet}
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
  sheet,
  locale,
  when,
  modeLabel,
  statusLabel,
  note,
  t,
}: {
  sheet: CaptureSheetView;
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
              {sheet.promptIds.map((id) => (
                <li
                  key={id}
                  className="rounded-lg border border-dashed bg-muted/20 px-3 py-2 font-mono text-xs [overflow-wrap:anywhere]"
                >
                  {id}
                </li>
              ))}
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
                {sheet.attempts.map((attempt) => (
                  <li key={attempt.id} className="min-w-0 space-y-2 rounded-xl border bg-muted/30 p-4 text-sm">
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
                    </p>
                    {confirmedIds[attempt.id] ? (
                      <NoticeBanner notice={{ kind: "status", text: t("confirmedSaved") }} />
                    ) : null}
                    {attempt.status === "handoff" ? (
                      <p className="text-xs text-muted-foreground">{t("confirmHint")}</p>
                    ) : !attempt.confirmed ? (
                      <ConfirmAttemptForm
                        attemptId={attempt.id}
                        t={t}
                        onConfirmed={() => setConfirmedIds((prev) => ({ ...prev, [attempt.id]: true }))}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid gap-4 border-t pt-4 lg:grid-cols-2">
            <RecordAttemptForm sheetId={sheet.id} t={t} />
            {sheet.mode === "assisted" ? (
              <DegradeSheetForm sheetId={sheet.id} t={t} notice={degradeNotice} onNotice={setDegradeNotice} />
            ) : (
              <div className="space-y-3 rounded-xl border border-dashed bg-muted/20 p-4 text-sm">
                <h4 className="font-semibold">{t("degradeTitle")}</h4>
                <NoticeBanner notice={degradeNotice} />
                <p className="leading-6 text-muted-foreground">{t("manualActiveNote")}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

function CreateSheetForm({ brandId, t }: { brandId: string; t: Translator }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = createCaptureSheetSchema.safeParse({
      brandId,
      promptIds: parsePromptIds(data.get("promptIds")),
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

function RecordAttemptForm({ sheetId, t }: { sheetId: string; t: Translator }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const blockId = `capture-blocked-${sheetId}`;
  const citationId = `capture-citations-${sheetId}`;
  const citationHintId = `capture-citations-hint-${sheetId}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const rawBlock = String(data.get("blockedBy") ?? "");
    const parsed = recordCaptureAttemptSchema.safeParse({
      sheetId,
      blockedBy: rawBlock.length === 0 ? null : rawBlock,
      citationCount: parseCount(data.get("citationCount")),
    });
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
        <Label htmlFor={blockId}>{t("blockedBy")}</Label>
        <select id={blockId} name="blockedBy" defaultValue="" disabled={pending} className={selectClass}>
          <option value="">{t("blockedNone")}</option>
          <option value="captcha">{t("blockedCaptcha")}</option>
          <option value="login">{t("blockedLogin")}</option>
        </select>
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={citationId}>{t("citationCount")}</Label>
        <Input
          id={citationId}
          name="citationCount"
          required
          inputMode="numeric"
          maxLength={4}
          defaultValue="0"
          autoComplete="off"
          spellCheck={false}
          readOnly={pending}
          aria-describedby={citationHintId}
          className={`${inputClass} tabular-nums`}
        />
        <p id={citationHintId} className="text-xs text-muted-foreground">{t("citationCountHint")}</p>
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
  attemptId,
  t,
  onConfirmed,
}: {
  attemptId: string;
  t: Translator;
  onConfirmed: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsed = confirmCaptureAttemptSchema.safeParse({ confirmed: true });
    if (!parsed.success) {
      setNotice({ kind: "alert", text: t("INVALID_INPUT") });
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/monitoring/capture/attempts/${encodeURIComponent(attemptId)}/confirm`, {
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
    <form onSubmit={submit} className="space-y-2 pt-1">
      <NoticeBanner notice={notice} />
      <p className="text-xs text-muted-foreground">{t("confirmHint")}</p>
      <Button type="submit" variant="outline" aria-disabled={pending} className={actionClass}>
        {pending ? t("confirming") : t("confirm")}
      </Button>
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

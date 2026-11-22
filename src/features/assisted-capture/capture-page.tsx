import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { getConnection } from "@/lib/db/connection";
import { formatNumber } from "@/lib/i18n/format";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao";
import {
  confirmCaptureAttemptAction,
  createCaptureSheetAction,
  degradeCaptureSheetAction,
  recordCaptureAttemptAction,
} from "./actions";
import { listCaptureSheets, type CaptureAttemptView, type CaptureSheetView } from "./commands";

const knownErrors = ["NOT_FOUND", "INVALID_INPUT"] as const;
const inputClass = "h-10 w-full rounded-md border bg-background px-3";

function isKnownError(value: string | undefined): value is (typeof knownErrors)[number] {
  return knownErrors.some((code) => code === value);
}

export async function generateMetadata() {
  const t = await getTranslator("assistedCapture");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const locale = await getLocale();
  const t = await getTranslator("assistedCapture");
  const errorCode = typeof params.error === "string" ? params.error : undefined;
  const connection = getConnection();
  const active = await new BrandDao(connection).active(session.user.id);
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

  if (!active) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>
        <Button asChild><Link href="/dashboard/brands" prefetch={false}>{t("openBrand")}</Link></Button>
      </div>
    );
  }

  const listed = await listCaptureSheets(connection, session.user.id, active.id);
  const sheets: CaptureSheetView[] = "error" in listed ? [] : listed.sheets;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/monitoring/overview" prefetch={false}>{t("backOverview")}</Link>
        </Button>
      </div>

      {isKnownError(errorCode) ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(errorCode)}</p>
      ) : null}
      {"error" in listed && listed.error ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(listed.error)}</p>
      ) : null}

      <p className="text-sm text-muted-foreground">{active.name}</p>

      <form action={createCaptureSheetAction} className="grid gap-4 rounded-2xl border p-5 sm:grid-cols-2">
        <h2 className="text-lg font-semibold sm:col-span-2">{t("createTitle")}</h2>
        <input type="hidden" name="brandId" value={active.id} />
        <label className="space-y-2 text-sm sm:col-span-2">
          <span>{t("promptIds")}</span>
          <textarea name="promptIds" required rows={4} maxLength={8000} autoComplete="off" spellCheck={false} className={`${inputClass} h-auto py-2 font-mono`} />
          <span className="block text-muted-foreground">{t("promptIdsHint")}</span>
        </label>
        <label className="space-y-2 text-sm">
          <span>{t("assistedMinutes")}</span>
          <input name="assistedMinutes" inputMode="numeric" maxLength={6} autoComplete="off" spellCheck={false} className={`${inputClass} tabular-nums`} />
          <span className="block text-muted-foreground">{t("assistedMinutesHint")}</span>
        </label>
        <label className="space-y-2 text-sm">
          <span>{t("manualMinutes")}</span>
          <input name="manualMinutes" inputMode="numeric" maxLength={6} autoComplete="off" spellCheck={false} className={`${inputClass} tabular-nums`} />
          <span className="block text-muted-foreground">{t("manualMinutesHint")}</span>
        </label>
        <label className="space-y-2 text-sm sm:col-span-2">
          <span>{t("citationsComplete")}</span>
          <select name="citationsComplete" required defaultValue="false" className={inputClass}>
            <option value="true">{t("citationsCompleteYes")}</option>
            <option value="false">{t("citationsCompleteNo")}</option>
          </select>
        </label>
        <div>
          <Button type="submit">{t("create")}</Button>
        </div>
      </form>

      {sheets.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
      ) : sheets.map((sheet) => (
        <section key={sheet.id} className="space-y-5 rounded-2xl border p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">{modeLabel[sheet.mode]}</h2>
            <p className="text-sm tabular-nums">
              {sheet.savedMinutes === null ? t("savedMinutesEmpty") : t("savedMinutesLine", { minutes: formatNumber(locale, sheet.savedMinutes) })}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("citationsComplete")}: {sheet.citationsComplete ? t("citationsCompleteYes") : t("citationsCompleteNo")}
            {" · "}
            {t("assistedMinutes")} {sheet.assistedMinutes ?? "—"}
            {" · "}
            {t("manualMinutes")} {sheet.manualMinutes ?? "—"}
          </p>
          <p className="text-sm text-muted-foreground">{t("switchedAccountNo")} {t("manualStillAvailable")}</p>

          <div className="space-y-3">
            <h3 className="text-base font-semibold">{t("promptHeading")}</h3>
            <ul className="space-y-2">
              {sheet.promptIds.map((id) => (
                <li key={id} className="break-all rounded-xl border border-dashed px-4 py-3 font-mono text-sm">{id}</li>
              ))}
            </ul>
          </div>

          <div className="space-y-3">
            <h3 className="text-base font-semibold">{t("attemptsHeading")}</h3>
            {sheet.attempts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noAttempts")}</p>
            ) : (
              <ul className="space-y-3">
                {sheet.attempts.map((attempt) => (
                  <li key={attempt.id} className="space-y-2 rounded-xl border border-dashed px-4 py-3 text-sm">
                    <p className="font-medium">{statusLabel[attempt.status]}</p>
                    <p>{note[attempt.status]}</p>
                    <p>
                      {attempt.blockedBy === "captcha" ? t("blockedCaptcha") : attempt.blockedBy === "login" ? t("blockedLogin") : t("blockedNone")}
                      {" · "}
                      {t("citationCount")} {formatNumber(locale, attempt.citationCount)}
                    </p>
                    <p>{attempt.complete ? t("completeYes") : t("completeNo")}</p>
                    <p>{attempt.saved ? t("savedYes") : t("savedNo")}</p>
                    <form action={confirmCaptureAttemptAction} className="space-y-2">
                      <input type="hidden" name="attemptId" value={attempt.id} />
                      <input type="hidden" name="confirmed" value="true" />
                      <p className="text-muted-foreground">{t("confirmHint")}</p>
                      <Button type="submit" variant="outline">{t("confirm")}</Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form action={recordCaptureAttemptAction} className="grid gap-4 sm:grid-cols-2">
            <h3 className="text-base font-semibold sm:col-span-2">{t("attemptTitle")}</h3>
            <input type="hidden" name="sheetId" value={sheet.id} />
            <label className="space-y-2 text-sm">
              <span>{t("blockedBy")}</span>
              <select name="blockedBy" defaultValue="" className={inputClass}>
                <option value="">{t("blockedNone")}</option>
                <option value="captcha">{t("blockedCaptcha")}</option>
                <option value="login">{t("blockedLogin")}</option>
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span>{t("citationCount")}</span>
              <input name="citationCount" required inputMode="numeric" maxLength={4} defaultValue="0" autoComplete="off" spellCheck={false} className={`${inputClass} tabular-nums`} />
              <span className="block text-muted-foreground">{t("citationCountHint")}</span>
            </label>
            <div>
              <Button type="submit">{t("recordAttempt")}</Button>
            </div>
          </form>

          <form action={degradeCaptureSheetAction} className="grid gap-4 sm:grid-cols-2">
            <h3 className="text-base font-semibold sm:col-span-2">{t("degradeTitle")}</h3>
            <input type="hidden" name="sheetId" value={sheet.id} />
            <label className="space-y-2 text-sm sm:col-span-2">
              <span>{t("structureChanged")}</span>
              <select name="structureChanged" required defaultValue="false" className={inputClass}>
                <option value="true">{t("structureChangedYes")}</option>
                <option value="false">{t("structureChangedNo")}</option>
              </select>
              <span className="block text-muted-foreground">{t("degradeHint")}</span>
            </label>
            <div>
              <Button type="submit" variant="outline">{t("degrade")}</Button>
            </div>
          </form>
        </section>
      ))}
    </div>
  );
}

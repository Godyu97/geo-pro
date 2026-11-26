import type { Messages } from "@/lib/i18n/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestSavedComparisonAction, requestSavedReminderAction } from "./actions";

const fieldClass = "h-10 w-full min-w-0 max-w-full rounded-lg border bg-background px-3 text-sm";

type ReportsTranslator = (
  key: keyof Messages["reports"],
  params?: Record<string, string | number>,
) => string;

export type ReportPublicationOption = {
  id: string;
  status: string;
  effectiveAt: string | null;
};

function PublicationSelect({
  id,
  label,
  none,
  publications,
  publicationId,
  noEffective,
  option,
}: {
  id: string;
  label: string;
  none: string;
  publications: readonly ReportPublicationOption[];
  publicationId?: string;
  noEffective: string;
  option: (status: string, effective: string) => string;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-sm sm:col-span-2" htmlFor={id}>
      <span>{label}</span>
      <select id={id} name="publicationId" defaultValue={publicationId ?? ""} className={fieldClass}>
        <option value="">{none}</option>
        {publications.map((item) => (
          <option key={item.id} value={item.id}>
            {option(item.status, item.effectiveAt ?? noEffective)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ReportEntryPanel({
  brandId,
  publications,
  publicationId,
  error,
  downgraded,
  t,
}: {
  brandId: string;
  publications: readonly ReportPublicationOption[];
  publicationId?: string;
  error: string | null;
  downgraded: boolean;
  t: ReportsTranslator;
}) {
  return (
    <div className="min-w-0 space-y-4">
      {error ? <p role="alert" className="break-words text-sm leading-6">{error}</p> : null}
      {downgraded ? <p role="status" className="break-words text-sm leading-6">{t("downgradeNotice")}</p> : null}
      <section className="min-w-0 space-y-3 rounded-2xl border bg-card p-4" aria-labelledby="comparison-heading">
        <h2 id="comparison-heading" className="text-lg font-semibold">{t("requestTitle")}</h2>
        <p className="break-words text-sm leading-6 text-muted-foreground">{t("requestHint")}</p>
        <form action={requestSavedComparisonAction} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <input type="hidden" name="brandId" value={brandId} />
          <label className="grid min-w-0 gap-1 text-sm" htmlFor="comparison-track">
            <span>{t("trackLabel")}</span>
            <select id="comparison-track" name="track" defaultValue="model_api" className={fieldClass}>
              <option value="model_api">{t("trackModelApi")}</option>
              <option value="consumer_ui">{t("trackConsumerUi")}</option>
            </select>
          </label>
          <label className="grid min-w-0 gap-1 text-sm" htmlFor="comparison-intent">
            <span>{t("intentLabel")}</span>
            <select id="comparison-intent" name="intent" defaultValue="diagnostic" className={fieldClass}>
              <option value="diagnostic">{t("intentDiagnostic")}</option>
              <option value="business_loop">{t("intentBusinessLoop")}</option>
            </select>
          </label>
          <label className="grid min-w-0 gap-1 text-sm" htmlFor="comparison-before-start">
            <span>{t("beforeStart")}</span>
            <Input id="comparison-before-start" name="beforeStart" required autoComplete="off" inputMode="numeric" pattern="\d{4}-\d{2}-\d{2}" placeholder="2026-11-01" maxLength={10} />
          </label>
          <label className="grid min-w-0 gap-1 text-sm" htmlFor="comparison-before-end">
            <span>{t("beforeEnd")}</span>
            <Input id="comparison-before-end" name="beforeEnd" required autoComplete="off" inputMode="numeric" pattern="\d{4}-\d{2}-\d{2}" placeholder="2026-11-08" maxLength={10} />
          </label>
          <label className="grid min-w-0 gap-1 text-sm" htmlFor="comparison-after-start">
            <span>{t("afterStart")}</span>
            <Input id="comparison-after-start" name="afterStart" required autoComplete="off" inputMode="numeric" pattern="\d{4}-\d{2}-\d{2}" placeholder="2026-11-09" maxLength={10} />
          </label>
          <label className="grid min-w-0 gap-1 text-sm" htmlFor="comparison-after-end">
            <span>{t("afterEnd")}</span>
            <Input id="comparison-after-end" name="afterEnd" required autoComplete="off" inputMode="numeric" pattern="\d{4}-\d{2}-\d{2}" placeholder="2026-11-16" maxLength={10} />
          </label>
          <label className="grid min-w-0 gap-1 text-sm sm:col-span-2" htmlFor="comparison-timezone">
            <span>{t("timezoneLabel")}</span>
            <Input id="comparison-timezone" name="timezone" required autoComplete="off" defaultValue="Asia/Shanghai" maxLength={80} />
          </label>
          <PublicationSelect
            id="comparison-publication"
            label={t("publicationLabel")}
            none={t("publicationNone")}
            publications={publications}
            publicationId={publicationId}
            noEffective={t("publicationNoEffective")}
            option={(status, effective) => t("publicationOption", { status, effective })}
          />
          <Button type="submit" className="h-auto max-w-full whitespace-normal sm:col-span-2">{t("submitComparison")}</Button>
        </form>
      </section>
      <section className="min-w-0 space-y-3 rounded-2xl border bg-card p-4" aria-labelledby="reminder-heading">
        <h2 id="reminder-heading" className="text-lg font-semibold">{t("reminderTitle")}</h2>
        <p className="break-words text-sm leading-6 text-muted-foreground">{t("reminderHint")}</p>
        <form action={requestSavedReminderAction} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <input type="hidden" name="brandId" value={brandId} />
          <label className="grid min-w-0 gap-1 text-sm" htmlFor="reminder-track">
            <span>{t("trackLabel")}</span>
            <select id="reminder-track" name="track" defaultValue="model_api" className={fieldClass}>
              <option value="model_api">{t("trackModelApi")}</option>
              <option value="consumer_ui">{t("trackConsumerUi")}</option>
            </select>
          </label>
          <label className="grid min-w-0 gap-1 text-sm" htmlFor="reminder-timezone">
            <span>{t("timezoneLabel")}</span>
            <Input id="reminder-timezone" name="timezone" required autoComplete="off" defaultValue="Asia/Shanghai" maxLength={80} />
          </label>
          <PublicationSelect
            id="reminder-publication"
            label={t("publicationLabel")}
            none={t("publicationNone")}
            publications={publications}
            publicationId={publicationId}
            noEffective={t("publicationNoEffective")}
            option={(status, effective) => t("publicationOption", { status, effective })}
          />
          <Button type="submit" variant="outline" className="h-auto max-w-full whitespace-normal sm:col-span-2">{t("submitReminder")}</Button>
        </form>
      </section>
    </div>
  );
}

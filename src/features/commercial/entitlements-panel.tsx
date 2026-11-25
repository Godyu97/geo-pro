"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import { formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { entitlementErrors, type EntitlementError, type EntitlementView, type EntitlementWorkspace } from "./entitlement-contracts.ts";
import { plainInteger, type UsageKind } from "./entitlement.ts";

type Copy = Messages["entitlements"];
type Translator = ReturnType<typeof createTranslator<Copy>>;
type Success = "saved" | "revised" | "usageSaved";
type Notice = EntitlementError | Success;

const fieldClass = "scroll-mt-20 h-10 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal aria-disabled:opacity-50";
const emptyClass = "rounded-xl border border-dashed bg-card p-4 text-sm leading-6 text-muted-foreground";
const summaryClass = "cursor-pointer rounded-sm py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring";
const returnPath = "/dashboard/commercial/entitlements";
const endpoint = "/api/commercial/entitlements";
const quotaFields = [
  { kind: "monitoring", field: "monitoringQuota", usage: "usageMonitoring" },
  { kind: "content", field: "contentQuota", usage: "usageContent" },
  { kind: "labor", field: "laborQuota", usage: "usageLabor" },
] as const satisfies ReadonlyArray<{ kind: UsageKind; field: keyof Copy & keyof EntitlementView; usage: keyof Copy }>;

function errorFrom(payload: unknown): EntitlementError {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return "SERVICE_UNAVAILABLE";
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return "SERVICE_UNAVAILABLE";
  return Object.hasOwn(entitlementErrors, error.code) ? error.code as EntitlementError : "SERVICE_UNAVAILABLE";
}

function wholeNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return Number.NaN;
  return Number(text);
}

function packageFields(data: FormData) {
  return {
    kind: String(data.get("kind") ?? ""),
    monitoringQuota: wholeNumber(data.get("monitoringQuota")),
    contentQuota: wholeNumber(data.get("contentQuota")),
    laborQuota: wholeNumber(data.get("laborQuota")),
  };
}

function useEntitlementWrite(url: string, success: Success, fields: (data: FormData) => object) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;
    const body = fields(new FormData(form));
    inFlight.current = true;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 401) {
        window.location.replace(loginPath(returnPath, "session-required"));
        return;
      }
      if (!response.ok) {
        setNotice(errorFrom(await response.json()));
        return;
      }
      setNotice(success);
      form.reset();
      router.refresh();
    } catch {
      setNotice("SERVICE_UNAVAILABLE");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { submit, pending, notice };
}

function SubmitFeedback({ label, pending, notice, t, invalidInput = "INVALID_INPUT" }: {
  label: string;
  pending: boolean;
  notice: Notice | null;
  t: Translator;
  invalidInput?: "INVALID_INPUT" | "invalidUsage";
}) {
  const isError = notice !== null && Object.hasOwn(entitlementErrors, notice);
  return (
    <>
      <Button type="submit" aria-disabled={pending} className={actionClass}>{pending ? t("saving") : label}</Button>
      <p role="status" className={isError ? "text-sm leading-6 text-destructive" : "text-sm leading-6 empty:sr-only"}>
        {notice && t(notice === "INVALID_INPUT" ? invalidInput : notice)}
      </p>
    </>
  );
}

export function EntitlementsPanel({ workspace, messages }: { workspace: EntitlementWorkspace; messages: Copy }) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const names = new Map(workspace.brands.map((brand) => [brand.id, brand.name]));
  return (
    <div className="min-w-0 space-y-6">
      {workspace.brands.length === 0 ? <p className={emptyClass}>{t("noBrands")}</p> : <RegisterForm t={t} brands={workspace.brands} />}
      <section className="space-y-3" aria-labelledby="service-entitlements-list-heading">
        <h2 id="service-entitlements-list-heading" tabIndex={-1} className="scroll-mt-20 rounded-sm text-lg font-semibold focus-visible:ring-2 focus-visible:ring-ring">{t("myEntitlements")}</h2>
        {workspace.entitlements.length === 0 ? <p className={emptyClass}>{t("empty")}</p> : (
          <ul className="space-y-3">
            {workspace.entitlements.map((entitlement) => (
              <li key={entitlement.id} className="min-w-0">
                <EntitlementCard entitlement={entitlement} brandName={names.get(entitlement.brandId) ?? entitlement.brandId} locale={locale} t={t} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function EntitlementCard({ entitlement, brandName, locale, t }: { entitlement: EntitlementView; brandName: string; locale: Locale; t: Translator }) {
  const id = `service-entitlement-${entitlement.id}`;
  const kind = t(entitlement.kind === "trial" ? "kindTrial" : "kindQuote");
  const date = new Date(entitlement.createdAt);
  const time = Number.isNaN(date.getTime()) ? entitlement.createdAt : `${formatDateTime(locale, date, "UTC")} UTC`;
  return (
    <article aria-labelledby={id} className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={id} className="font-semibold">{t("versionTitle", { kind, version: plainInteger(entitlement.version) })}</h3>
          <Badge variant="secondary">{t("uncollected")}</Badge>
        </div>
        <p className="text-sm leading-6 break-words text-muted-foreground">{brandName}</p>
        <p className="text-sm text-muted-foreground">{t("createdAt")} <time dateTime={entitlement.createdAt}>{time}</time></p>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {quotaFields.map(({ kind, field, usage }) => (
          <dl key={kind} className="space-y-1 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <div className="flex flex-wrap justify-between gap-x-2">
              <dt>{t(field)}</dt>
              <dd className="font-medium tabular-nums">{plainInteger(entitlement[field])}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-2 text-muted-foreground">
              <dt>{t(usage)}</dt>
              <dd className="font-medium tabular-nums">{plainInteger(entitlement.usageTotals[kind])}</dd>
            </div>
          </dl>
        ))}
      </div>
      <UsageForm entitlementId={entitlement.id} t={t} />
      <ReviseForm entitlementId={entitlement.id} t={t} />
    </article>
  );
}

function RegisterForm({ brands, t }: { brands: EntitlementWorkspace["brands"]; t: Translator }) {
  const operation = useEntitlementWrite(endpoint, "saved", (data) => ({
    brandId: String(data.get("brandId") ?? ""),
    ...packageFields(data),
  }));
  return (
    <form onSubmit={operation.submit} aria-labelledby="service-entitlement-register" className="min-w-0 max-w-2xl space-y-4 rounded-xl border bg-card p-4">
      <h2 id="service-entitlement-register" className="text-lg font-semibold">{t("registerTitle")}</h2>
      <label className="block space-y-1 text-sm" htmlFor="service-entitlement-brand">
        <span>{t("brand")}</span>
        <select id="service-entitlement-brand" name="brandId" required className={fieldClass}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
        </select>
      </label>
      <PackageFields idPrefix="service-entitlement" t={t} />
      <SubmitFeedback label={t("registerEntitlement")} pending={operation.pending} notice={operation.notice} t={t} />
    </form>
  );
}

function ReviseForm({ entitlementId, t }: { entitlementId: string; t: Translator }) {
  const operation = useEntitlementWrite(`${endpoint}/${entitlementId}/revise`, "revised", packageFields);
  const id = `service-entitlement-revise-${entitlementId}`;
  return (
    <details className="border-t">
      <summary id={id} className={summaryClass}>{t("reviseTitle")}</summary>
      <form onSubmit={operation.submit} aria-labelledby={id} className="max-w-2xl space-y-3 py-2">
        <PackageFields idPrefix={id} t={t} />
        <SubmitFeedback label={t("reviseEntitlement")} pending={operation.pending} notice={operation.notice} t={t} />
      </form>
    </details>
  );
}

function UsageForm({ entitlementId, t }: { entitlementId: string; t: Translator }) {
  const operation = useEntitlementWrite(`${endpoint}/${entitlementId}/usage`, "usageSaved", (data) => ({
    kind: String(data.get("kind") ?? ""),
    quantity: wholeNumber(data.get("quantity")),
  }));
  const id = `service-entitlement-usage-${entitlementId}`;
  return (
    <details className="border-t">
      <summary id={id} className={summaryClass}>{t("usageTitle")}</summary>
      <form onSubmit={operation.submit} aria-labelledby={id} className="max-w-2xl space-y-3 py-2">
        <label className="block space-y-1 text-sm" htmlFor={`${id}-kind`}>
          <span>{t("usageKind")}</span>
          <select id={`${id}-kind`} name="kind" required className={fieldClass} defaultValue="monitoring">
            {quotaFields.map(({ kind, usage }) => <option key={kind} value={kind}>{t(usage)}</option>)}
          </select>
        </label>
        <label className="block space-y-1 text-sm" htmlFor={`${id}-quantity`}>
          <span>{t("usageQuantity")}</span>
          <Input id={`${id}-quantity`} name="quantity" required inputMode="numeric" defaultValue={1} autoComplete="off" className="h-10" />
        </label>
        <SubmitFeedback label={t("recordUsage")} pending={operation.pending} notice={operation.notice} t={t} invalidInput="invalidUsage" />
      </form>
    </details>
  );
}

function PackageFields({ idPrefix, t }: { idPrefix: string; t: Translator }) {
  return (
    <>
      <label className="block space-y-1 text-sm" htmlFor={`${idPrefix}-kind`}>
        <span>{t("kind")}</span>
        <select id={`${idPrefix}-kind`} name="kind" required className={fieldClass} defaultValue="trial">
          <option value="trial">{t("kindTrial")}</option>
          <option value="quote">{t("kindQuote")}</option>
        </select>
      </label>
      <div className="grid gap-3 md:grid-cols-3">
        {quotaFields.map(({ kind, field }) => (
          <label key={kind} className="block min-w-0 space-y-1 text-sm" htmlFor={`${idPrefix}-${kind}`}>
            <span>{t(field)}</span>
            <Input id={`${idPrefix}-${kind}`} name={field} required inputMode="numeric" defaultValue={0} autoComplete="off" className="h-10" />
          </label>
        ))}
      </div>
    </>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { entitlementErrors, type EntitlementError, type EntitlementWorkspace } from "./entitlement-contracts.ts";
import { plainInteger, type EntitlementKind, type UsageKind } from "./entitlement.ts";

type Copy = Messages["entitlements"];
type Translator = (key: keyof Copy) => string;

const fieldClass = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";
const returnPath = "/dashboard/commercial/entitlements";

function noticeFrom(payload: unknown, t: Translator) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return t("SERVICE_UNAVAILABLE");
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return t("SERVICE_UNAVAILABLE");
  return error.code in entitlementErrors ? t(error.code as EntitlementError) : t("SERVICE_UNAVAILABLE");
}

function wholeNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return Number.NaN;
  return Number(text);
}

function kindLabel(kind: EntitlementKind, t: Translator) {
  return kind === "trial" ? t("kindTrial") : t("kindQuote");
}

function usageLabel(kind: UsageKind, t: Translator) {
  if (kind === "monitoring") return t("usageMonitoring");
  if (kind === "content") return t("usageContent");
  return t("usageLabor");
}

export function EntitlementsPanel({ workspace, messages }: { workspace: EntitlementWorkspace; messages: Copy }) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const names = new Map(workspace.brands.map((brand) => [brand.id, brand.name]));
  return (
    <div className="min-w-0 space-y-6">
      {workspace.brands.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("noBrands")}</p> : <RegisterForm t={t} brands={workspace.brands} />}
      <section className="space-y-3" aria-labelledby="service-entitlements-list-heading">
        <h2 id="service-entitlements-list-heading" className="text-base font-semibold">{t("myEntitlements")}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{t("quotaHint")}</p>
        {workspace.entitlements.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("empty")}</p> : (
          <ul className="space-y-3">
            {workspace.entitlements.map((entitlement) => (
              <li key={entitlement.id} className="min-w-0 space-y-3 rounded-xl border p-5">
                <p className="text-sm font-medium">{kindLabel(entitlement.kind, t)}</p>
                <p className="text-sm text-muted-foreground">{t("version")} <span>{plainInteger(entitlement.version)}</span></p>
                <p className="break-all text-sm text-muted-foreground">{names.get(entitlement.brandId) ?? entitlement.brandId}</p>
                <p className="text-sm">{t("monitoringQuota")} <span>{plainInteger(entitlement.monitoringQuota)}</span> · {usageLabel("monitoring", t)} <span>{plainInteger(entitlement.usageTotals.monitoring)}</span></p>
                <p className="text-sm">{t("contentQuota")} <span>{plainInteger(entitlement.contentQuota)}</span> · {usageLabel("content", t)} <span>{plainInteger(entitlement.usageTotals.content)}</span></p>
                <p className="text-sm">{t("laborQuota")} <span>{plainInteger(entitlement.laborQuota)}</span> · {usageLabel("labor", t)} <span>{plainInteger(entitlement.usageTotals.labor)}</span></p>
                <p className="text-sm">{t("chargeStatus")} <span>{t("uncollected")}</span></p>
                <p className="text-sm text-muted-foreground">{t("createdAt")} <time dateTime={entitlement.createdAt}>{entitlement.createdAt}</time></p>
                <ReviseForm entitlementId={entitlement.id} t={t} />
                <UsageForm entitlementId={entitlement.id} t={t} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RegisterForm({ brands, t }: { brands: EntitlementWorkspace["brands"]; t: Translator }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/commercial/entitlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: String(data.get("brandId") ?? ""),
          kind: String(data.get("kind") ?? ""),
          monitoringQuota: wholeNumber(data.get("monitoringQuota")),
          contentQuota: wholeNumber(data.get("contentQuota")),
          laborQuota: wholeNumber(data.get("laborQuota")),
        }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath(returnPath, "session-required"));
          return;
        }
        setNotice(noticeFrom(await response.json(), t));
        return;
      }
      setNotice(t("saved"));
      form.reset();
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border p-5">
      <h2 className="text-base font-semibold">{t("registerTitle")}</h2>
      <label className="block space-y-1 text-sm" htmlFor="service-entitlement-brand">
        <span>{t("brand")}</span>
        <select id="service-entitlement-brand" name="brandId" required className={fieldClass}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm" htmlFor="service-entitlement-kind">
        <span>{t("kind")}</span>
        <select id="service-entitlement-kind" name="kind" required className={fieldClass} defaultValue="trial">
          <option value="trial">{t("kindTrial")}</option>
          <option value="quote">{t("kindQuote")}</option>
        </select>
      </label>
      <QuotaFields idPrefix="service-entitlement" t={t} />
      <Button type="submit" disabled={pending}>{pending ? t("saving") : t("registerEntitlement")}</Button>
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </form>
  );
}

function ReviseForm({ entitlementId, t }: { entitlementId: string; t: Translator }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/commercial/entitlements/${entitlementId}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: String(data.get("kind") ?? ""),
          monitoringQuota: wholeNumber(data.get("monitoringQuota")),
          contentQuota: wholeNumber(data.get("contentQuota")),
          laborQuota: wholeNumber(data.get("laborQuota")),
        }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath(returnPath, "session-required"));
          return;
        }
        setNotice(noticeFrom(await response.json(), t));
        return;
      }
      setNotice(t("revised"));
      form.reset();
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 border-t pt-3">
      <h3 className="text-sm font-medium">{t("reviseTitle")}</h3>
      <label className="block space-y-1 text-sm" htmlFor={`service-entitlement-revise-kind-${entitlementId}`}>
        <span>{t("kind")}</span>
        <select id={`service-entitlement-revise-kind-${entitlementId}`} name="kind" required className={fieldClass} defaultValue="trial">
          <option value="trial">{t("kindTrial")}</option>
          <option value="quote">{t("kindQuote")}</option>
        </select>
      </label>
      <QuotaFields idPrefix={`service-entitlement-revise-${entitlementId}`} t={t} />
      <Button type="submit" disabled={pending}>{pending ? t("saving") : t("reviseEntitlement")}</Button>
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </form>
  );
}

function UsageForm({ entitlementId, t }: { entitlementId: string; t: Translator }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/commercial/entitlements/${entitlementId}/usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: String(data.get("kind") ?? ""),
          quantity: wholeNumber(data.get("quantity")),
        }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath(returnPath, "session-required"));
          return;
        }
        setNotice(noticeFrom(await response.json(), t));
        return;
      }
      setNotice(t("usageSaved"));
      form.reset();
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 border-t pt-3">
      <h3 className="text-sm font-medium">{t("usageTitle")}</h3>
      <label className="block space-y-1 text-sm" htmlFor={`service-entitlement-usage-kind-${entitlementId}`}>
        <span>{t("usageKind")}</span>
        <select id={`service-entitlement-usage-kind-${entitlementId}`} name="kind" required className={fieldClass} defaultValue="monitoring">
          <option value="monitoring">{t("usageMonitoring")}</option>
          <option value="content">{t("usageContent")}</option>
          <option value="labor">{t("usageLabor")}</option>
        </select>
      </label>
      <label className="block space-y-1 text-sm" htmlFor={`service-entitlement-usage-quantity-${entitlementId}`}>
        <span>{t("usageQuantity")}</span>
        <Input id={`service-entitlement-usage-quantity-${entitlementId}`} name="quantity" required inputMode="numeric" min={1} max={1000000} defaultValue={1} autoComplete="off" />
      </label>
      <Button type="submit" disabled={pending}>{pending ? t("saving") : t("recordUsage")}</Button>
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </form>
  );
}

function QuotaFields({ idPrefix, t }: { idPrefix: string; t: Translator }) {
  return (
    <>
      <label className="block space-y-1 text-sm" htmlFor={`${idPrefix}-monitoring`}>
        <span>{t("monitoringQuota")}</span>
        <Input id={`${idPrefix}-monitoring`} name="monitoringQuota" required inputMode="numeric" min={0} max={1000000} defaultValue={0} autoComplete="off" />
      </label>
      <label className="block space-y-1 text-sm" htmlFor={`${idPrefix}-content`}>
        <span>{t("contentQuota")}</span>
        <Input id={`${idPrefix}-content`} name="contentQuota" required inputMode="numeric" min={0} max={1000000} defaultValue={0} autoComplete="off" />
      </label>
      <label className="block space-y-1 text-sm" htmlFor={`${idPrefix}-labor`}>
        <span>{t("laborQuota")}</span>
        <Input id={`${idPrefix}-labor`} name="laborQuota" required inputMode="numeric" min={0} max={1000000} defaultValue={0} autoComplete="off" />
      </label>
    </>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { deliveryErrors, type DeliveryError, type DeliveryView, type DeliveryWorkspace } from "./delivery-contracts.ts";

type Copy = Messages["deliveries"];
type Translator = (key: keyof Copy) => string;

const fieldClass = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

function noticeFrom(payload: unknown, t: Translator) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return t("SERVICE_UNAVAILABLE");
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return t("SERVICE_UNAVAILABLE");
  return error.code in deliveryErrors ? t(error.code as DeliveryError) : t("SERVICE_UNAVAILABLE");
}

function statusLabel(delivery: DeliveryView, t: Translator) {
  if (delivery.status === "accepted") return t("statusAccepted");
  if (delivery.status === "disputed") return t("statusDisputed");
  return t("statusPending");
}

export function DeliveriesPanel({ workspace, messages }: { workspace: DeliveryWorkspace; messages: Copy }) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const names = new Map(workspace.brands.map((brand) => [brand.id, brand.name]));
  return (
    <div className="min-w-0 space-y-6">
      {workspace.brands.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("noBrands")}</p> : <RegisterForm t={t} brands={workspace.brands} />}
      <section className="space-y-3" aria-labelledby="brand-deliveries-list-heading">
        <h2 id="brand-deliveries-list-heading" className="text-base font-semibold">{t("myDeliveries")}</h2>
        {workspace.deliveries.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("empty")}</p> : (
          <ul className="space-y-3">
            {workspace.deliveries.map((delivery) => (
              <li key={delivery.id} className="min-w-0 space-y-2 rounded-xl border p-5">
                <p className="text-sm font-medium">{statusLabel(delivery, t)}</p>
                <p className="break-all text-sm">{delivery.title}</p>
                <p className="break-all text-sm text-muted-foreground">{names.get(delivery.brandId) ?? delivery.brandId}</p>
                <p className="text-sm text-muted-foreground">{t("createdAt")} <time dateTime={delivery.createdAt}>{delivery.createdAt}</time></p>
                {delivery.status === "accepted" ? <p className="text-sm text-muted-foreground">{t("acceptanceNote")}</p> : null}
                {delivery.status === "disputed" && delivery.disputeReason ? (
                  <p className="break-all text-sm">{t("disputeReason")}: {delivery.disputeReason}</p>
                ) : null}
                {delivery.status === "pending" ? <PendingActions deliveryId={delivery.id} t={t} /> : null}
                {delivery.status === "disputed" ? <AcceptAction deliveryId={delivery.id} t={t} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RegisterForm({ brands, t }: { brands: DeliveryWorkspace["brands"]; t: Translator }) {
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
      const response = await fetch("/api/commercial/deliveries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: String(data.get("brandId") ?? ""),
          title: String(data.get("title") ?? ""),
        }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath("/dashboard/commercial/deliveries", "session-required"));
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
      <label className="block space-y-1 text-sm" htmlFor="brand-delivery-brand">
        <span>{t("brand")}</span>
        <select id="brand-delivery-brand" name="brandId" required className={fieldClass}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm" htmlFor="brand-delivery-title">
        <span>{t("deliveryTitle")}</span>
        <Input id="brand-delivery-title" name="title" required minLength={1} maxLength={120} autoComplete="off" />
      </label>
      <Button type="submit" disabled={pending}>{pending ? t("saving") : t("registerDelivery")}</Button>
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </form>
  );
}

function AcceptAction({ deliveryId, t }: { deliveryId: string; t: Translator }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function accept() {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/commercial/deliveries/${deliveryId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath("/dashboard/commercial/deliveries", "session-required"));
          return;
        }
        setNotice(noticeFrom(await response.json(), t));
        return;
      }
      setNotice(t("acceptedNotice"));
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" onClick={accept} disabled={pending}>{pending ? t("accepting") : t("accept")}</Button>
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </div>
  );
}

function PendingActions({ deliveryId, t }: { deliveryId: string; t: Translator }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function dispute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/commercial/deliveries/${deliveryId}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: String(data.get("reason") ?? "") }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath("/dashboard/commercial/deliveries", "session-required"));
          return;
        }
        setNotice(noticeFrom(await response.json(), t));
        return;
      }
      setNotice(t("disputedNotice"));
      form.reset();
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <AcceptAction deliveryId={deliveryId} t={t} />
      <form onSubmit={dispute} className="space-y-2">
        <label className="block space-y-1 text-sm" htmlFor={`brand-delivery-reason-${deliveryId}`}>
          <span>{t("disputeReason")}</span>
          <textarea id={`brand-delivery-reason-${deliveryId}`} name="reason" required minLength={1} maxLength={500} className="min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm" />
          <span className="text-muted-foreground">{t("reasonHint")}</span>
        </label>
        <Button type="submit" variant="outline" disabled={pending}>{pending ? t("disputing") : t("dispute")}</Button>
        {notice && <p role="status" className="text-sm">{notice}</p>}
      </form>
    </div>
  );
}

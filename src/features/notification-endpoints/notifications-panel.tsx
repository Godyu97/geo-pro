"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import {
  notificationEndpointErrors,
  type NotificationEndpointError,
  type NotificationEndpointView,
} from "./contracts.ts";

type Copy = Messages["notificationEndpoints"];
type Translator = (key: keyof Copy) => string;

const selectClass = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";
const bodyClass = "min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm";

function noticeFrom(payload: unknown, t: Translator) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return t("SERVICE_UNAVAILABLE");
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return t("SERVICE_UNAVAILABLE");
  return error.code in notificationEndpointErrors ? t(error.code as NotificationEndpointError) : t("SERVICE_UNAVAILABLE");
}

function deliveryResult(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("endpoint" in payload)) return null;
  const endpoint = payload.endpoint;
  if (!endpoint || typeof endpoint !== "object" || !("deliveries" in endpoint)) return null;
  const deliveries = endpoint.deliveries;
  if (!Array.isArray(deliveries) || deliveries.length === 0) return null;
  const last = deliveries[deliveries.length - 1];
  if (!last || typeof last !== "object" || !("sent" in last) || typeof last.sent !== "boolean") return null;
  return last.sent;
}

export function NotificationsPanel({ brands, endpoints, labels, messages }: {
  brands: { id: string }[];
  endpoints: NotificationEndpointView[];
  labels: { brandId: string; name: string }[];
  messages: Copy;
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const labelFor = (brandId: string) => labels.find((label) => label.brandId === brandId)?.name ?? brandId;

  return (
    <div className="min-w-0 space-y-6">
      {brands.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("noBrands")}</p> : (
        <RegisterForm brands={brands} labelFor={labelFor} t={t} />
      )}
      {endpoints.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("emptyEndpoints")}</p> : endpoints.map((endpoint) => (
        <EndpointCard key={endpoint.id} endpoint={endpoint} label={labelFor(endpoint.brandId)} t={t} />
      ))}
    </div>
  );
}

function RegisterForm({ brands, labelFor, t }: {
  brands: { id: string }[];
  labelFor: (brandId: string) => string;
  t: Translator;
}) {
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
      const response = await fetch("/api/settings/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: String(data.get("brandId") ?? ""),
          label: String(data.get("label") ?? "").trim(),
        }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath("/dashboard/settings/notifications", "session-required"));
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
    <form onSubmit={submit} className="min-w-0 space-y-4 rounded-xl border bg-card p-5">
      <h2 className="font-medium">{t("register")}</h2>
      {notice && <p role="status" className="text-sm leading-6">{notice}</p>}
      <label className="block space-y-1 text-sm">
        <span>{t("brand")}</span>
        <select name="brandId" required className={selectClass} defaultValue={brands[0]?.id}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{labelFor(brand.id)}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        <span>{t("label")}</span>
        <Input name="label" required maxLength={80} autoComplete="off" />
        <span className="block text-muted-foreground">{t("labelHint")}</span>
      </label>
      <Button type="submit" disabled={pending}>{pending ? t("registering") : t("register")}</Button>
    </form>
  );
}

function EndpointCard({ endpoint, label, t }: {
  endpoint: NotificationEndpointView;
  label: string;
  t: Translator;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function post(path: string, body: string, form?: HTMLFormElement) {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath("/dashboard/settings/notifications", "session-required"));
          return;
        }
        setNotice(noticeFrom(await response.json(), t));
        return;
      }
      const payload: unknown = await response.json();
      const sent = deliveryResult(payload);
      setNotice(sent === null ? t("saved") : sent ? t("sent") : t("notSent"));
      form?.reset();
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="min-w-0 space-y-4 rounded-xl border bg-card p-5">
      <div className="space-y-1">
        <h2 className="font-medium break-words">{endpoint.label}</h2>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-sm">{t("status")}: {endpoint.status === "verified" ? t("statusVerified") : t("statusRevoked")}</p>
      </div>
      {notice && <p role="status" className="text-sm leading-6">{notice}</p>}
      {endpoint.status === "revoked" ? <p className="text-sm leading-6 text-muted-foreground">{t("revokedNote")}</p> : (
        <Button type="button" variant="outline" disabled={pending} onClick={() => void post(`/api/settings/notifications/${endpoint.id}/revoke`, "{}")}>
          {t("revoke")}
        </Button>
      )}
      <p className="text-sm leading-6 text-muted-foreground">{t("historyKept")}</p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void post(
            `/api/settings/notifications/${endpoint.id}/deliveries`,
            JSON.stringify({ body: String(data.get("body") ?? "") }),
            form,
          );
        }}
      >
        <label className="block space-y-1 text-sm">
          <span>{t("body")}</span>
          <textarea name="body" required maxLength={400} className={bodyClass} autoComplete="off" />
          <span className="block text-muted-foreground">{t("bodyHint")}</span>
        </label>
        <Button type="submit" disabled={pending}>{pending ? t("requesting") : t("requestDelivery")}</Button>
      </form>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t("deliveries")}</h3>
        <p className="text-sm leading-6 text-muted-foreground">{t("localOnly")}</p>
        {endpoint.deliveries.length === 0 ? <p className="text-sm text-muted-foreground">{t("emptyDeliveries")}</p> : (
          <ul className="space-y-3">
            {endpoint.deliveries.map((delivery) => (
              <li key={delivery.id} className="min-w-0 space-y-1 rounded-lg border p-3 text-sm">
                <p>{delivery.sent ? t("sent") : t("notSent")}</p>
                <p>{delivery.bodyHasCustomerText ? t("customerText") : t("noCustomerText")}</p>
                <p className="break-all">{t("bodyHash")}: <code>{delivery.bodyHash}</code></p>
                <p className="text-muted-foreground">{t("createdAt")}: <time dateTime={delivery.createdAt}>{delivery.createdAt}</time></p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

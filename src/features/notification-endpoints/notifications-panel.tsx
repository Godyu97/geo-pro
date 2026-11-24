"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import { formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import {
  notificationEndpointErrors,
  type NotificationEndpointError,
  type NotificationEndpointView,
} from "./contracts.ts";

type Copy = Messages["notificationEndpoints"];
type Translator = (key: keyof Copy, params?: Record<string, string | number>) => string;
type Notice = NotificationEndpointError | "saved" | "revokedSaved" | "sent" | "notSent";

const path = "/dashboard/settings/notifications";
const api = "/api/settings/notifications";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal aria-disabled:opacity-50";
const selectClass = "min-h-10 w-full min-w-0 scroll-mt-20 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";
const bodyClass = "min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

function isEndpointError(code: string): code is NotificationEndpointError {
  return Object.hasOwn(notificationEndpointErrors, code);
}

function errorFrom(payload: unknown): NotificationEndpointError {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return "SERVICE_UNAVAILABLE";
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return "SERVICE_UNAVAILABLE";
  return isEndpointError(error.code) ? error.code : "SERVICE_UNAVAILABLE";
}

function deliveryNotice(payload: unknown): Notice {
  if (!payload || typeof payload !== "object" || !("delivery" in payload)) return "SERVICE_UNAVAILABLE";
  const delivery = payload.delivery;
  if (!delivery || typeof delivery !== "object" || !("sent" in delivery) || typeof delivery.sent !== "boolean") return "SERVICE_UNAVAILABLE";
  return delivery.sent ? "sent" : "notSent";
}

function OperationNotice({ notice, t }: { notice: Notice | null; t: Translator }) {
  return (
    <div role="status">
      {notice ? <p className={isEndpointError(notice) ? "text-sm leading-6 text-destructive" : "text-sm leading-6"}>{t(notice)}</p> : null}
    </div>
  );
}

export function NotificationsPanel({ brands, endpoints, labels, brandFieldId, messages }: {
  brands: { id: string }[];
  endpoints: NotificationEndpointView[];
  labels: { brandId: string; name: string }[];
  brandFieldId: string;
  messages: Copy;
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const labelFor = (brandId: string) => labels.find((label) => label.brandId === brandId)?.name ?? brandId;

  return (
    <>
      <section aria-labelledby="notification-endpoint-records" className="min-w-0 space-y-3">
        <h2 id="notification-endpoint-records" className="text-lg font-semibold">{t("recordsTitle")}</h2>
        {endpoints.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card p-4 text-sm leading-6 text-muted-foreground">{t("emptyEndpoints")}</p>
        ) : endpoints.map((endpoint) => (
          <EndpointCard key={endpoint.id} endpoint={endpoint} label={labelFor(endpoint.brandId)} locale={locale} t={t} />
        ))}
      </section>
      {brands.length > 0 ? <RegisterForm brands={brands} brandFieldId={brandFieldId} labelFor={labelFor} t={t} /> : null}
    </>
  );
}

function RegisterForm({ brands, brandFieldId, labelFor, t }: {
  brands: { id: string }[];
  brandFieldId: string;
  labelFor: (brandId: string) => string;
  t: Translator;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: String(data.get("brandId") ?? ""),
          label: String(data.get("label") ?? "").trim(),
        }),
      });
      if (response.status === 401) {
        window.location.replace(loginPath(path, "session-required"));
        return;
      }
      if (!response.ok) {
        setNotice(errorFrom(await response.json()));
        return;
      }
      setNotice("saved");
      form.reset();
      router.refresh();
    } catch {
      setNotice("SERVICE_UNAVAILABLE");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} aria-labelledby="notification-endpoint-registration" className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
      <h2 id="notification-endpoint-registration" className="text-lg font-semibold">{t("register")}</h2>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("brand")}</span>
        <select id={brandFieldId} name="brandId" required className={selectClass} defaultValue={brands[0]?.id}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{labelFor(brand.id)}</option>)}
        </select>
      </label>
      <div className="min-w-0 space-y-1 text-sm">
        <label htmlFor="notification-endpoint-label">{t("label")}</label>
        <Input id="notification-endpoint-label" name="label" required maxLength={80} autoComplete="off"
          className="min-h-10" aria-describedby="notification-endpoint-label-hint" />
        <p id="notification-endpoint-label-hint" className="text-muted-foreground">{t("labelHint")}</p>
      </div>
      <Button type="submit" aria-disabled={pending} className={actionClass}>{pending ? t("registering") : t("register")}</Button>
      <OperationNotice notice={notice} t={t} />
    </form>
  );
}

function EndpointCard({ endpoint, label, locale, t }: {
  endpoint: NotificationEndpointView;
  label: string;
  locale: Locale;
  t: Translator;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"revoke" | "deliveries" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const revokedOnClose = useRef(false);
  const titleId = `notification-endpoint-${endpoint.id}`;
  const revoked = endpoint.status === "revoked";

  async function post(action: "revoke" | "deliveries", form?: HTMLFormElement) {
    if (pending) return;
    const body = form ? { body: String(new FormData(form).get("body") ?? "") } : {};
    setPending(action);
    setNotice(null);
    try {
      const response = await fetch(`${api}/${endpoint.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 401) {
        window.location.replace(loginPath(path, "session-required"));
        return;
      }
      if (!response.ok) {
        setNotice(errorFrom(await response.json()));
        return;
      }
      if (action === "revoke") {
        setNotice("revokedSaved");
        revokedOnClose.current = true;
        setConfirming(false);
      } else {
        setNotice(deliveryNotice(await response.json()));
        form?.reset();
      }
      router.refresh();
    } catch {
      setNotice("SERVICE_UNAVAILABLE");
    } finally {
      setPending(null);
    }
  }

  return (
    <article aria-labelledby={titleId} className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
      <div className="space-y-1">
        <h3 id={titleId} ref={heading} tabIndex={-1}
          className="scroll-mt-20 rounded-sm font-medium [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-ring">
          {endpoint.label}
        </h3>
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{label}</p>
      </div>
      <dl className="space-y-1 text-sm">
        <dt className="font-medium">{t("status")}</dt>
        <dd><Badge variant={revoked ? "outline" : "secondary"}>{t(revoked ? "statusRevoked" : "statusVerified")}</Badge></dd>
      </dl>
      {revoked ? <p className="text-sm leading-6 text-muted-foreground">{t("revokedNote")}</p> : (
        <Dialog open={confirming} onOpenChange={(open) => {
          if (pending) return;
          setNotice(null);
          setConfirming(open);
        }}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" aria-disabled={pending !== null} className={actionClass}>{t("revoke")}</Button>
          </DialogTrigger>
          <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
            onCloseAutoFocus={(event) => {
              if (!revokedOnClose.current) return;
              event.preventDefault();
              heading.current?.focus();
            }}>
            <DialogHeader>
              <DialogTitle>{t("revoke")}</DialogTitle>
              <DialogDescription className="[overflow-wrap:anywhere]">{t("confirmDescription", { endpoint: endpoint.label })}</DialogDescription>
            </DialogHeader>
            <OperationNotice notice={notice} t={t} />
            <DialogFooter className="flex-col">
              <DialogClose asChild>
                <Button type="button" variant="outline" aria-disabled={pending !== null} className={actionClass}>{t("cancel")}</Button>
              </DialogClose>
              <Button type="button" variant="destructive" aria-disabled={pending !== null} className={actionClass}
                onClick={() => void post("revoke")}>
                {pending === "revoke" ? t("registering") : t("confirmRevoke")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <form
        aria-label={t("requestDelivery")}
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void post("deliveries", event.currentTarget);
        }}
      >
        <div className="space-y-1 text-sm">
          <label htmlFor={`${titleId}-body`}>{t("body")}</label>
          <textarea id={`${titleId}-body`} name="body" required maxLength={400} className={bodyClass} autoComplete="off"
            aria-describedby={`${titleId}-body-hint`} />
          <p id={`${titleId}-body-hint`} className="text-muted-foreground">{t("bodyHint")}</p>
        </div>
        <Button type="submit" aria-disabled={pending !== null} className={actionClass}>
          {pending === "deliveries" ? t("requesting") : t("requestDelivery")}
        </Button>
      </form>
      <OperationNotice notice={confirming ? null : notice} t={t} />
      <div className="space-y-2">
        <h4 className="text-sm font-medium">{t("deliveries")}</h4>
        {endpoint.deliveries.length === 0 ? <p className="text-sm text-muted-foreground">{t("emptyDeliveries")}</p> : (
          <ol className="space-y-3">
            {endpoint.deliveries.map((delivery) => (
              <li key={delivery.id} className="min-w-0 space-y-1 rounded-lg border p-3 text-sm">
                <Badge variant={delivery.sent ? "secondary" : "outline"}>{t(delivery.sent ? "sent" : "notSent")}</Badge>
                <p>{delivery.bodyHasCustomerText ? t("customerText") : t("noCustomerText")}</p>
                <p className="[overflow-wrap:anywhere]">{t("bodyHash")} <code>{delivery.bodyHash}</code></p>
                <p className="text-muted-foreground">
                  {t("createdAt")} <time dateTime={delivery.createdAt}>{formatDateTime(locale, new Date(delivery.createdAt), "UTC")}</time> UTC
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </article>
  );
}

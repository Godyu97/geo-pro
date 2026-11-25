"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import { formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { deliveryErrors, type DeliveryError, type DeliveryView, type DeliveryWorkspace } from "./delivery-contracts.ts";

type Copy = Messages["deliveries"];
type Translator = (key: keyof Copy) => string;

const fieldClass = "w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal aria-disabled:opacity-50";
const emptyClass = "rounded-xl border border-dashed bg-card p-4 text-sm leading-6 text-muted-foreground";
const headingClass = "scroll-mt-20 rounded-sm font-semibold focus-visible:ring-2 focus-visible:ring-ring";
const statusCopy = { pending: "statusPending", accepted: "statusAccepted", disputed: "statusDisputed" } as const;

function errorFrom(payload: unknown): DeliveryError {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return "SERVICE_UNAVAILABLE";
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return "SERVICE_UNAVAILABLE";
  return Object.hasOwn(deliveryErrors, error.code) ? error.code as DeliveryError : "SERVICE_UNAVAILABLE";
}

async function writeDelivery(path: string, body: object): Promise<DeliveryError | null> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return null;
    if (response.status === 401) {
      window.location.replace(loginPath("/dashboard/commercial/deliveries", "session-required"));
      return "SESSION_REQUIRED";
    }
    return errorFrom(await response.json());
  } catch {
    return "SERVICE_UNAVAILABLE";
  }
}

type Notice = DeliveryError | "saved" | "acceptedNotice" | "disputedNotice";

function OperationNotice({ notice, t }: { notice: Notice | null; t: Translator }) {
  const isError = notice !== null && Object.hasOwn(deliveryErrors, notice);
  return (
    <p role="status" className={isError ? "text-sm leading-6 text-destructive" : "text-sm leading-6 empty:sr-only"}>
      {notice && t(notice)}
    </p>
  );
}

export function DeliveriesPanel({ workspace, messages }: { workspace: DeliveryWorkspace; messages: Copy }) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const names = new Map(workspace.brands.map((brand) => [brand.id, brand.name]));
  return (
    <div className="min-w-0 space-y-6">
      {workspace.brands.length === 0 ? <p className={emptyClass}>{t("noBrands")}</p> : <RegisterForm t={t} brands={workspace.brands} />}
      <section className="space-y-3" aria-labelledby="brand-deliveries-list-heading">
        <h2 id="brand-deliveries-list-heading" tabIndex={-1} className={`${headingClass} text-lg`}>{t("myDeliveries")}</h2>
        {workspace.deliveries.length === 0 ? <p className={emptyClass}>{t("empty")}</p> : (
          <ul className="space-y-3">
            {workspace.deliveries.map((delivery) => (
              <DeliveryCard key={delivery.id} delivery={delivery} brandName={names.get(delivery.brandId) ?? delivery.brandId} t={t} locale={locale} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RegisterForm({ brands, t }: { brands: DeliveryWorkspace["brands"]; t: Translator }) {
  const router = useRouter();
  const requestInFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlight.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    if (!title) {
      setNotice("INVALID_INPUT");
      return;
    }
    requestInFlight.current = true;
    setPending(true);
    setNotice(null);
    try {
      const error = await writeDelivery("/api/commercial/deliveries", {
        brandId: String(data.get("brandId") ?? ""),
        title,
      });
      if (error) {
        setNotice(error);
        return;
      }
      setNotice("saved");
      form.reset();
      router.refresh();
    } finally {
      requestInFlight.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} aria-labelledby="brand-delivery-form-heading" className="min-w-0 max-w-2xl space-y-4 rounded-xl border bg-card p-4">
      <h2 id="brand-delivery-form-heading" className="text-lg font-semibold">{t("registerTitle")}</h2>
      <label className="block space-y-1 text-sm" htmlFor="brand-delivery-brand">
        <span>{t("brand")}</span>
        <select id="brand-delivery-brand" name="brandId" required className={`${fieldClass} h-10 scroll-mt-20`}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm" htmlFor="brand-delivery-title">
        <span>{t("deliveryTitle")}</span>
        <Input id="brand-delivery-title" name="title" required maxLength={120} autoComplete="off" className="h-10"
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
          }} />
      </label>
      <Button type="submit" aria-disabled={pending} className={actionClass}>{pending ? t("saving") : t("registerDelivery")}</Button>
      <OperationNotice notice={notice} t={t} />
    </form>
  );
}

type Resolution = { status: "accepted"; disputeReason: null } | { status: "disputed"; disputeReason: string };

function DeliveryCard({ delivery, brandName, locale, t }: {
  delivery: DeliveryView;
  brandName: string;
  locale: Locale;
  t: Translator;
}) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const requestInFlight = useRef(false);
  const [working, setWorking] = useState<Resolution["status"] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [resolved, setResolved] = useState<Resolution | null>(null);
  const visible = delivery.status === "pending" && resolved ? resolved : delivery;
  const id = `brand-delivery-${delivery.id}`;
  const createdAt = new Date(delivery.createdAt);
  const time = Number.isNaN(createdAt.getTime()) ? delivery.createdAt : `${formatDateTime(locale, createdAt, "UTC")} UTC`;

  async function resolve(outcome: Resolution) {
    if (requestInFlight.current || visible.status !== "pending") return;
    requestInFlight.current = true;
    setWorking(outcome.status);
    setNotice(null);
    try {
      const action = outcome.status === "accepted" ? "accept" : "dispute";
      const error = await writeDelivery(
        `/api/commercial/deliveries/${delivery.id}/${action}`,
        outcome.status === "disputed" ? { reason: outcome.disputeReason } : {},
      );
      if (error) {
        setNotice(error);
        return;
      }
      setResolved(outcome);
      setNotice(outcome.status === "accepted" ? "acceptedNotice" : "disputedNotice");
      if (outcome.status === "accepted") setConfirming(false);
      else heading.current?.focus();
      router.refresh();
    } finally {
      requestInFlight.current = false;
      setWorking(null);
    }
  }

  function dispute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlight.current) return;
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (!reason) {
      setNotice("INVALID_INPUT");
      return;
    }
    void resolve({ status: "disputed", disputeReason: reason });
  }

  return (
    <li className="min-w-0">
      <article aria-labelledby={id} className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
        <h3 id={id} ref={heading} tabIndex={-1} className={`${headingClass} text-sm [overflow-wrap:anywhere]`}>{delivery.title}</h3>
        <Badge variant={visible.status === "disputed" ? "destructive" : visible.status === "pending" ? "secondary" : "outline"}>
          {t(statusCopy[visible.status])}
        </Badge>
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{brandName}</p>
        <p className="text-sm text-muted-foreground">
          {t("createdAt")} <time dateTime={delivery.createdAt} className="[overflow-wrap:anywhere]">{time}</time>
        </p>
        {visible.status === "accepted" && <p className="text-sm text-muted-foreground">{t("acceptanceNote")}</p>}
        {visible.status === "disputed" && (
          <div className="space-y-1 text-sm">
            <p className="font-medium">{t("disputeReason")}</p>
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{visible.disputeReason}</p>
          </div>
        )}
        <Dialog open={confirming} onOpenChange={(open) => {
          if (requestInFlight.current) return;
          setNotice(null);
          setConfirming(open);
        }}>
          {visible.status === "pending" && (
            <DialogTrigger asChild>
              <Button type="button" disabled={working === "disputed"} className={actionClass}>{t("accept")}</Button>
            </DialogTrigger>
          )}
          <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
            onCloseAutoFocus={(event) => {
              if (visible.status === "pending") return;
              event.preventDefault();
              heading.current?.focus();
            }}>
            <DialogHeader>
              <DialogTitle>{t("confirmAcceptance")}</DialogTitle>
              <DialogDescription>{t("acceptanceImpact")}</DialogDescription>
            </DialogHeader>
            <OperationNotice notice={confirming ? notice : null} t={t} />
            <DialogFooter className="flex-col">
              <DialogClose asChild>
                <Button type="button" variant="outline" aria-disabled={working !== null} className={actionClass}>{t("cancel")}</Button>
              </DialogClose>
              <Button type="button" aria-disabled={working !== null} className={actionClass}
                onClick={() => void resolve({ status: "accepted", disputeReason: null })}>
                {working === "accepted" ? t("accepting") : t("confirmAcceptance")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {visible.status === "pending" && (
          <form onSubmit={dispute} className="max-w-2xl space-y-2">
            <label className="block space-y-1 text-sm" htmlFor={`${id}-reason`}>
              <span>{t("disputeReason")}</span>
              <textarea id={`${id}-reason`} name="reason" required maxLength={500} aria-describedby={`${id}-hint`}
                className={`${fieldClass} min-h-20 py-2`} />
            </label>
            <p id={`${id}-hint`} className="text-sm text-muted-foreground">{t("reasonHint")}</p>
            <Button type="submit" variant="outline" aria-disabled={working !== null} className={actionClass}>
              {working === "disputed" ? t("disputing") : t("dispute")}
            </Button>
          </form>
        )}
        <OperationNotice notice={confirming ? null : notice} t={t} />
      </article>
    </li>
  );
}

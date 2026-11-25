"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import { formatDateTime } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { formatOrderMoney, orderErrors, type OrderError, type OrderWorkspace } from "./order-contracts.ts";

type Copy = Messages["orders"];
type Translator = (key: keyof Copy) => string;

const fieldClass = "h-10 w-full min-w-0 scroll-mt-20 rounded-lg border border-input bg-background px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const emptyClass = "rounded-xl border border-dashed bg-card p-4 text-sm leading-6 text-muted-foreground";

function errorFrom(payload: unknown): OrderError {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return "SERVICE_UNAVAILABLE";
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return "SERVICE_UNAVAILABLE";
  return Object.hasOwn(orderErrors, error.code) ? error.code as OrderError : "SERVICE_UNAVAILABLE";
}

export function OrdersPanel({ workspace, messages }: { workspace: OrderWorkspace; messages: Copy }) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const names = new Map(workspace.brands.map((brand) => [brand.id, brand.name]));
  return (
    <div className="min-w-0 space-y-6">
      {workspace.brands.length === 0 ? <p className={emptyClass}>{t("noBrands")}</p> : <OrderForm t={t} brands={workspace.brands} />}
      <section className="space-y-3" aria-labelledby="service-orders-heading">
        <h2 id="service-orders-heading" tabIndex={-1} className="scroll-mt-20 rounded-sm text-lg font-semibold focus-visible:ring-2 focus-visible:ring-ring">
          {t("myOrders")}
        </h2>
        {workspace.orders.length === 0 ? <p className={emptyClass}>{t("empty")}</p> : (
          <ul className="space-y-3">
            {workspace.orders.map((order) => {
              const awaitingPayment = order.status === "awaiting_payment";
              const createdAt = new Date(order.createdAt);
              const time = Number.isNaN(createdAt.getTime()) ? order.createdAt : `${formatDateTime(locale, createdAt, "UTC")} UTC`;

              return (
                <li key={order.id} className="min-w-0 space-y-2 rounded-xl border bg-card p-4">
                  <h3 className="text-sm font-semibold [overflow-wrap:anywhere]">{names.get(order.brandId) ?? order.brandId}</h3>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Badge variant={awaitingPayment ? "secondary" : "outline"}>{t(awaitingPayment ? "statusAwaitingPayment" : "statusDraft")}</Badge>
                    <span className="text-sm text-muted-foreground">{t(order.quoted === 1 ? "quoted" : "unquoted")}</span>
                  </div>
                  <p className="text-sm">
                    <span className="text-muted-foreground">{t("amount")}</span>{" "}
                    <bdi translate="no" className="font-medium tabular-nums">{formatOrderMoney(order.amount, order.currency)}</bdi>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t("createdAt")} <time dateTime={order.createdAt} className="[overflow-wrap:anywhere]">{time}</time>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function OrderForm({ brands, t }: { brands: OrderWorkspace["brands"]; t: Translator }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<OrderError | "saved" | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const amountText = String(data.get("amount") ?? "").trim();
    const amount = /^\d{1,10}$/.test(amountText) ? Number(amountText) : Number.NaN;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/commercial/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: String(data.get("brandId") ?? ""),
          quoted: data.get("quoted") === "on",
          amount,
          currency: String(data.get("currency") ?? "").trim().toUpperCase(),
        }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath("/dashboard/commercial/orders", "session-required"));
          return;
        }
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
    <form onSubmit={submit} aria-labelledby="service-order-form-heading" className="min-w-0 max-w-2xl space-y-4 rounded-xl border bg-card p-4">
      <h2 id="service-order-form-heading" className="text-lg font-semibold">{t("orderTitle")}</h2>
      <label className="block space-y-1 text-sm" htmlFor="service-order-brand">
        <span>{t("brand")}</span>
        <select id="service-order-brand" name="brandId" required className={fieldClass}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm" htmlFor="service-order-quoted">
        <input id="service-order-quoted" name="quoted" type="checkbox" aria-describedby="service-order-quoted-hint" className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-ring" />
        <span>{t("quoted")}</span>
      </label>
      <p id="service-order-quoted-hint" className="text-sm text-muted-foreground">{t("quotedHint")}</p>
      <label className="block space-y-1 text-sm" htmlFor="service-order-amount">
        <span>{t("amount")}</span>
        <Input id="service-order-amount" name="amount" required inputMode="numeric" autoComplete="off" className="h-10" />
      </label>
      <label className="block space-y-1 text-sm" htmlFor="service-order-currency">
        <span>{t("currency")}</span>
        <Input id="service-order-currency" name="currency" aria-describedby="service-order-currency-hint" required minLength={3} maxLength={3} autoComplete="off" spellCheck={false} placeholder="CNY" className="h-10" />
      </label>
      <p id="service-order-currency-hint" className="text-sm text-muted-foreground">{t("currencyHint")}</p>
      <Button type="submit" aria-disabled={pending} className="h-auto min-h-10 max-w-full py-2 whitespace-normal aria-disabled:opacity-50">
        {pending ? t("saving") : t("registerOrder")}
      </Button>
      <p role="status" className={notice && notice !== "saved" ? "text-sm leading-6 text-destructive" : "text-sm leading-6 empty:sr-only"}>
        {notice && t(notice)}
      </p>
    </form>
  );
}

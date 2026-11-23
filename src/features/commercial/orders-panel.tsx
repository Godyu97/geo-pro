"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { formatOrderMoney, orderErrors, type OrderError, type OrderView, type OrderWorkspace } from "./order-contracts.ts";

type Copy = Messages["orders"];
type Translator = (key: keyof Copy) => string;

const fieldClass = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

function noticeFrom(payload: unknown, t: Translator) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return t("SERVICE_UNAVAILABLE");
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return t("SERVICE_UNAVAILABLE");
  return error.code in orderErrors ? t(error.code as OrderError) : t("SERVICE_UNAVAILABLE");
}

function statusLabel(order: OrderView, t: Translator) {
  return order.status === "awaiting_payment" ? t("statusAwaitingPayment") : t("statusDraft");
}

export function OrdersPanel({ workspace, messages }: { workspace: OrderWorkspace; messages: Copy }) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const names = new Map(workspace.brands.map((brand) => [brand.id, brand.name]));
  return (
    <div className="min-w-0 space-y-6">
      {workspace.brands.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("noBrands")}</p> : <OrderForm t={t} brands={workspace.brands} />}
      <section className="space-y-3" aria-labelledby="service-orders-heading">
        <h2 id="service-orders-heading" className="text-base font-semibold">{t("myOrders")}</h2>
        {workspace.orders.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("empty")}</p> : (
          <ul className="space-y-3">
            {workspace.orders.map((order) => (
              <li key={order.id} className="min-w-0 space-y-2 rounded-xl border p-5">
                <p className="text-sm font-medium">{statusLabel(order, t)}</p>
                <p className="text-sm">{order.quoted === 1 ? t("quoted") : t("unquoted")}</p>
                <p className="text-sm"><bdi translate="no">{formatOrderMoney(order.amount, order.currency)}</bdi></p>
                <p className="break-all text-sm text-muted-foreground">{names.get(order.brandId) ?? order.brandId}</p>
                <p className="text-sm text-muted-foreground">{t("createdAt")} <time dateTime={order.createdAt}>{order.createdAt}</time></p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function OrderForm({ brands, t }: { brands: OrderWorkspace["brands"]; t: Translator }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
      <h2 className="text-base font-semibold">{t("orderTitle")}</h2>
      <label className="block space-y-1 text-sm" htmlFor="service-order-brand">
        <span>{t("brand")}</span>
        <select id="service-order-brand" name="brandId" required className={fieldClass}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm" htmlFor="service-order-quoted">
        <input id="service-order-quoted" name="quoted" type="checkbox" />
        <span>{t("quoted")}</span>
      </label>
      <p className="text-sm text-muted-foreground">{t("quotedHint")}</p>
      <label className="block space-y-1 text-sm" htmlFor="service-order-amount">
        <span>{t("amount")}</span>
        <Input id="service-order-amount" name="amount" required inputMode="numeric" min={0} max={2000000000} step={1} autoComplete="off" />
      </label>
      <label className="block space-y-1 text-sm" htmlFor="service-order-currency">
        <span>{t("currency")}</span>
        <Input id="service-order-currency" name="currency" required minLength={3} maxLength={3} autoComplete="off" spellCheck={false} placeholder="CNY" />
        <span className="text-muted-foreground">{t("currencyHint")}</span>
      </label>
      <Button type="submit" disabled={pending}>{pending ? t("saving") : t("registerOrder")}</Button>
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </form>
  );
}

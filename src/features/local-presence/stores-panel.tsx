"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import {
  brandStoreErrors,
  recordStoreFactUseSchema,
  registerBrandStoreSchema,
  type BrandStoreError,
  type BrandStoreView,
  type StoreFactUseView,
} from "./store-contracts.ts";

type Copy = Messages["brandStores"];
type Translator = (key: keyof Copy, params?: Record<string, string | number>) => string;

const fieldClass = "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm";
const returnPath = "/dashboard/brands/stores";

function isBrandStoreError(code: string): code is BrandStoreError {
  return Object.hasOwn(brandStoreErrors, code);
}

function noticeFrom(payload: unknown, t: Translator) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return t("SERVICE_UNAVAILABLE");
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return t("SERVICE_UNAVAILABLE");
  return isBrandStoreError(error.code) ? t(error.code) : t("SERVICE_UNAVAILABLE");
}

export function BrandStoresPanel({ brands, stores, uses, labels, messages }: {
  brands: { id: string }[];
  stores: BrandStoreView[];
  uses: StoreFactUseView[];
  labels: { brandId: string; name: string }[];
  messages: Copy;
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const labelFor = (brandId: string) => labels.find((label) => label.brandId === brandId)?.name ?? brandId;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const usesFor = (storeId: string) => uses.filter((item) => item.storeId === storeId);

  return (
    <div className="space-y-6">
      {brands.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("noBrands")}</p> : (
        <RegisterForm brands={brands} labelFor={labelFor} t={t} />
      )}
      {stores.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("empty")}</p> : (
        <ul className="space-y-3">
          {stores.map((store) => (
            <li key={store.id} className="min-w-0 space-y-3 rounded-xl border bg-card p-5">
              <p className="break-words font-medium">{store.name}</p>
              <p className="break-words text-sm leading-6 text-muted-foreground">{labelFor(store.brandId)}</p>
              <p className="break-words text-sm leading-6">{t("serviceAreaLine", { area: store.serviceArea })}</p>
              <p className="text-sm leading-6 text-muted-foreground">{t("createdAt", { time: when.format(new Date(store.createdAt)) })}</p>
              <UseForm store={store} t={t} />
              {usesFor(store.id).length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("useEmpty")}</p> : (
                <ul className="space-y-2">
                  {usesFor(store.id).map((item) => (
                    <li key={item.id} className="min-w-0 space-y-1 rounded-lg border p-3">
                      <p className="break-words text-sm leading-6">{t("useLine", { area: item.serviceArea })}</p>
                      <p className="text-sm leading-6 text-muted-foreground">{t("ownStoreOnly")}</p>
                      <p className="text-sm leading-6 text-muted-foreground">{t("recordedAt", { time: when.format(new Date(item.recordedAt)) })}</p>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
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
    const parsed = registerBrandStoreSchema.safeParse({
      brandId: String(data.get("brandId") ?? ""),
      name: String(data.get("name") ?? ""),
      serviceArea: String(data.get("serviceArea") ?? ""),
    });
    if (!parsed.success) {
      setNotice(t("INVALID_INPUT"));
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/brands/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
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
    <form onSubmit={submit} className="min-w-0 space-y-4 rounded-xl border bg-card p-5">
      <h2 className="font-medium">{t("registerTitle")}</h2>
      {notice && <p role="status" className="text-sm leading-6">{notice}</p>}
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("brand")}</span>
        <select name="brandId" required className={fieldClass} defaultValue={brands[0]?.id}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{labelFor(brand.id)}</option>)}
        </select>
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("storeName")}</span>
        <input name="name" type="text" required maxLength={80} autoComplete="off" className={fieldClass} />
        <span className="block text-muted-foreground">{t("storeNameHint")}</span>
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("serviceArea")}</span>
        <input name="serviceArea" type="text" required maxLength={160} autoComplete="off" className={fieldClass} />
        <span className="block text-muted-foreground">{t("serviceAreaHint")}</span>
      </label>
      <Button type="submit" disabled={pending}>{pending ? t("registering") : t("registerAction")}</Button>
    </form>
  );
}

function UseForm({ store, t }: { store: BrandStoreView; t: Translator }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = recordStoreFactUseSchema.safeParse({
      serviceArea: String(data.get("serviceArea") ?? ""),
    });
    if (!parsed.success) {
      setNotice(t("INVALID_INPUT"));
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/brands/stores/${store.id}/uses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath(returnPath, "session-required"));
          return;
        }
        setNotice(noticeFrom(await response.json(), t));
        return;
      }
      setNotice(t("useSaved"));
      form.reset();
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="min-w-0 space-y-3 rounded-lg border p-3">
      <h3 className="text-sm font-medium">{t("useTitle")}</h3>
      {notice && <p role="status" className="text-sm leading-6">{notice}</p>}
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("serviceArea")}</span>
        <input name="serviceArea" type="text" required maxLength={160} autoComplete="off" defaultValue={store.serviceArea} className={fieldClass} />
        <span className="block text-muted-foreground">{t("useHint")}</span>
      </label>
      <Button type="submit" disabled={pending}>{pending ? t("using") : t("useAction")}</Button>
    </form>
  );
}

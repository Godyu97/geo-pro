"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginPath } from "@/lib/auth/return-to";
import type { Locale } from "@/lib/i18n/locale";
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
type Notice = { kind: "status" | "alert"; text: string };

const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center aria-disabled:opacity-60";
const wrapBadgeClass = "h-auto max-w-full whitespace-normal rounded-xl px-3 py-1 text-left leading-5 [overflow-wrap:anywhere]";
const selectClass = "box-border block h-10 w-full min-w-0 max-w-full truncate rounded-lg border border-input bg-background px-3 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const emptySurfaceClass = "rounded-xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]";
const returnPath = "/dashboard/brands/stores";

function isBrandStoreError(code: string): code is BrandStoreError {
  return Object.hasOwn(brandStoreErrors, code);
}

function NoticeBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <p
      role={notice.kind}
      className={notice.kind === "alert"
        ? "rounded-xl border border-destructive/30 bg-card px-4 py-3 text-sm leading-6 text-destructive"
        : "rounded-xl border bg-card px-4 py-3 text-sm leading-6 text-foreground"}
    >
      {notice.text}
    </p>
  );
}

function noticeFrom(payload: unknown, t: Translator) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return t("SERVICE_UNAVAILABLE");
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return t("SERVICE_UNAVAILABLE");
  return isBrandStoreError(error.code) ? t(error.code) : t("SERVICE_UNAVAILABLE");
}

export function BrandStoresPanel({ brands, stores, uses, labels, locale, messages }: {
  brands: { id: string }[];
  stores: BrandStoreView[];
  uses: StoreFactUseView[];
  labels: { brandId: string; name: string }[];
  locale: Locale;
  messages: Copy;
}) {
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const labelFor = (brandId: string) => labels.find((label) => label.brandId === brandId)?.name ?? brandId;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const usesFor = (storeId: string) => uses.filter((item) => item.storeId === storeId);
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [name, setName] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();
  const inFlightRef = useRef(false);

  function begin() {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    setPending(true);
    setNotice(null);
    return true;
  }

  function finish() {
    inFlightRef.current = false;
    setPending(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlightRef.current) return;
    const parsed = registerBrandStoreSchema.safeParse({ brandId, name, serviceArea });
    if (!parsed.success) {
      setNotice({ kind: "alert", text: t("INVALID_INPUT") });
      return;
    }
    if (!begin()) return;
    startTransition(async () => {
      try {
        const response = await fetch("/api/brands/stores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          if (response.status === 401) {
            window.location.replace(loginPath(returnPath, "session-required"));
            return;
          }
          setNotice({ kind: "alert", text: noticeFrom(payload, t) });
          return;
        }
        setName("");
        setServiceArea("");
        setNotice({ kind: "status", text: t("saved") });
        router.refresh();
      } catch {
        setNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
      } finally {
        finish();
      }
    });
  }

  return (
    <div className="min-w-0 space-y-6">
      {brands.length > 0 ? (
        <Card id="brand-store-form" className="min-w-0 scroll-mt-24">
          <CardHeader>
            <CardTitle>
              <h2 className="[overflow-wrap:anywhere]">{t("registerTitle")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid min-w-0 gap-4">
              <NoticeBanner notice={notice} />
              {brands.length > 1 ? (
                <div className="flex min-w-0 flex-col gap-2">
                  <Label htmlFor="brand-store-brand">{t("brand")}</Label>
                  <select
                    id="brand-store-brand"
                    value={brandId}
                    onChange={(event) => setBrandId(event.target.value)}
                    className={selectClass}
                  >
                    {brands.map((brand) => (
                      <option key={brand.id} value={brand.id}>{labelFor(brand.id)}</option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="brand-store-name">{t("storeName")}</Label>
                <Input
                  id="brand-store-name"
                  value={name}
                  maxLength={80}
                  autoComplete="off"
                  onChange={(event) => setName(event.target.value)}
                  className="h-10 bg-background"
                />
                <p className="text-sm leading-6 text-muted-foreground">{t("storeNameHint")}</p>
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="brand-store-area">{t("serviceArea")}</Label>
                <Input
                  id="brand-store-area"
                  value={serviceArea}
                  maxLength={160}
                  autoComplete="off"
                  onChange={(event) => setServiceArea(event.target.value)}
                  className="h-10 bg-background"
                />
                <p className="text-sm leading-6 text-muted-foreground">{t("serviceAreaHint")}</p>
              </div>
              <div>
                <Button type="submit" aria-disabled={pending} className={actionClass}>
                  {pending ? t("registering") : t("registerAction")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
      {stores.length === 0 ? <p className={emptySurfaceClass}>{t("empty")}</p> : (
        <div id="brand-store-list" tabIndex={-1} className="min-w-0 scroll-mt-24 space-y-4 outline-none focus-visible:outline-2 focus-visible:outline-ring">
          <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">{t("listTitle")}</h2>
          {stores.map((store) => (
            <Card key={store.id} className="min-w-0">
              <CardHeader>
                <CardTitle>
                  <h3 className="[overflow-wrap:anywhere]">{store.name}</h3>
                </CardTitle>
                <p className="text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">{labelFor(store.brandId)}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm leading-6 [overflow-wrap:anywhere]">{t("serviceAreaLine", { area: store.serviceArea })}</p>
                <p className="text-sm leading-6 text-muted-foreground">{t("createdAt", { time: when.format(new Date(store.createdAt)) })}</p>
                <UseForm store={store} t={t} />
                {usesFor(store.id).length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("useEmpty")}</p> : (
                  <ul className="space-y-2">
                    {usesFor(store.id).map((item) => (
                      <li key={item.id} className="min-w-0 space-y-1 rounded-lg border p-3">
                        <p className="text-sm leading-6 [overflow-wrap:anywhere]">{t("useLine", { area: item.serviceArea })}</p>
                        <Badge variant="outline" className={wrapBadgeClass}>{t("ownStoreOnly")}</Badge>
                        <p className="text-sm leading-6 text-muted-foreground">{t("recordedAt", { time: when.format(new Date(item.recordedAt)) })}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function UseForm({ store, t }: { store: BrandStoreView; t: Translator }) {
  const router = useRouter();
  const [serviceArea, setServiceArea] = useState(store.serviceArea);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();
  const inFlightRef = useRef(false);

  function begin() {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    setPending(true);
    setNotice(null);
    return true;
  }

  function finish() {
    inFlightRef.current = false;
    setPending(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlightRef.current) return;
    const parsed = recordStoreFactUseSchema.safeParse({ serviceArea });
    if (!parsed.success) {
      setNotice({ kind: "alert", text: t("INVALID_INPUT") });
      return;
    }
    if (!begin()) return;
    startTransition(async () => {
      try {
        const response = await fetch(`/api/brands/stores/${store.id}/uses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          if (response.status === 401) {
            window.location.replace(loginPath(returnPath, "session-required"));
            return;
          }
          setNotice({ kind: "alert", text: noticeFrom(payload, t) });
          return;
        }
        setNotice({ kind: "status", text: t("useSaved") });
        router.refresh();
      } catch {
        setNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
      } finally {
        finish();
      }
    });
  }

  return (
    <form id={`brand-store-check-${store.id}`} onSubmit={handleSubmit} className="grid min-w-0 gap-3 rounded-lg border p-3">
      <h4 className="text-sm font-medium [overflow-wrap:anywhere]">{t("useTitle")}</h4>
      <NoticeBanner notice={notice} />
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={`brand-store-check-area-${store.id}`}>{t("serviceArea")}</Label>
        <Input
          id={`brand-store-check-area-${store.id}`}
          value={serviceArea}
          maxLength={160}
          autoComplete="off"
          onChange={(event) => setServiceArea(event.target.value)}
          className="h-10 bg-background"
        />
        <p className="text-sm leading-6 text-muted-foreground">{t("useHint")}</p>
      </div>
      <div>
        <Button type="submit" aria-disabled={pending} className={actionClass}>
          {pending ? t("using") : t("useAction")}
        </Button>
      </div>
    </form>
  );
}

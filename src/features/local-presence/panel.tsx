"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import {
  localObservationErrors,
  registerLocalObservationSchema,
  unknownSampledPlace,
  type LocalObservationError,
  type LocalObservationView,
} from "./contracts.ts";

type Copy = Messages["localObservations"];
type Translator = (key: keyof Copy, params?: Record<string, string | number>) => string;

const fieldClass = "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm";
const returnPath = "/dashboard/brands/local-observations";

function isLocalObservationError(code: string): code is LocalObservationError {
  return Object.hasOwn(localObservationErrors, code);
}

function noticeFrom(payload: unknown, t: Translator) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return t("SERVICE_UNAVAILABLE");
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return t("SERVICE_UNAVAILABLE");
  return isLocalObservationError(error.code) ? t(error.code) : t("SERVICE_UNAVAILABLE");
}

export function LocalObservationsPanel({ brands, observations, labels, messages }: {
  brands: { id: string }[];
  observations: LocalObservationView[];
  labels: { brandId: string; name: string }[];
  messages: Copy;
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const labelFor = (brandId: string) => labels.find((label) => label.brandId === brandId)?.name ?? brandId;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

  return (
    <div className="space-y-6">
      {brands.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("noBrands")}</p> : (
        <RegisterForm brands={brands} labelFor={labelFor} t={t} />
      )}
      {observations.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("empty")}</p> : (
        <ul className="space-y-3">
          {observations.map((observation) => {
            const place = observation.actualStatus === unknownSampledPlace ? t("unknownPlace") : observation.sampledCity;
            return (
              <li key={observation.id} className="min-w-0 space-y-2 rounded-xl border bg-card p-5">
                <p className="break-words font-medium">{labelFor(observation.brandId)}</p>
                <p className="break-words text-sm leading-6">{t("targetLine", { city: observation.targetCity })}</p>
                <p className="break-words text-sm leading-6">{t("actualLine", { place: place ?? t("unknownPlace") })}</p>
                <p className="text-sm leading-6 text-muted-foreground">{t("unranked")}</p>
                <p className="text-sm leading-6 text-muted-foreground">{t("recordedAt", { time: when.format(new Date(observation.recordedAt)) })}</p>
              </li>
            );
          })}
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
    const sampled = String(data.get("sampledCity") ?? "").trim();
    const parsed = registerLocalObservationSchema.safeParse({
      brandId: String(data.get("brandId") ?? ""),
      targetCity: String(data.get("targetCity") ?? ""),
      sampledCity: sampled ? sampled : null,
    });
    if (!parsed.success) {
      setNotice(t("INVALID_INPUT"));
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/brands/local-observations", {
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
        <span>{t("targetCity")}</span>
        <input name="targetCity" type="text" required maxLength={80} autoComplete="off" className={fieldClass} />
        <span className="block text-muted-foreground">{t("targetHint")}</span>
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("sampledCity")}</span>
        <input name="sampledCity" type="text" maxLength={80} autoComplete="off" className={fieldClass} />
        <span className="block text-muted-foreground">{t("sampledHint")}</span>
      </label>
      <Button type="submit" disabled={pending}>{pending ? t("registering") : t("registerAction")}</Button>
    </form>
  );
}

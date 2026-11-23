"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import {
  createDemoObservationSchema,
  demoErrors,
  type DemoError,
  type DemoObservationView,
} from "./demo-contracts.ts";

type Copy = Messages["demoObservations"];
type Translator = (key: keyof Copy, params?: Record<string, string | number>) => string;

const fieldClass = "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm";
const returnPath = "/dashboard/monitoring/demo";

function isDemoError(code: string): code is DemoError {
  return Object.hasOwn(demoErrors, code);
}

function noticeFrom(payload: unknown, t: Translator) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return t("SERVICE_UNAVAILABLE");
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return t("SERVICE_UNAVAILABLE");
  return isDemoError(error.code) ? t(error.code) : t("SERVICE_UNAVAILABLE");
}

export function DemoObservationsPanel({ brands, observations, labels, selectedBrandId, idle, messages }: {
  brands: { id: string }[];
  observations: DemoObservationView[];
  labels: { brandId: string; name: string }[];
  selectedBrandId: string;
  idle: boolean;
  messages: Copy;
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const labelFor = (brandId: string) => labels.find((label) => label.brandId === brandId)?.name ?? brandId;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

  return (
    <div className="space-y-6">
      {brands.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("noBrands")}</p> : (
        <CreateForm brands={brands} labelFor={labelFor} selectedBrandId={selectedBrandId} t={t} />
      )}
      {idle ? <p className="text-sm leading-6 text-muted-foreground">{t("pickBrand")}</p> : null}
      {selectedBrandId && observations.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("empty")}</p> : null}
      {observations.length > 0 ? (
        <ul className="space-y-3">
          {observations.map((observation) => (
            <li key={observation.id} className="min-w-0 space-y-2 rounded-xl border bg-card p-5">
              <Badge variant="outline">{t("demoBadge")}</Badge>
              <p className="break-words text-sm leading-6 text-muted-foreground">{labelFor(observation.brandId)}</p>
              <p className="break-words text-sm leading-6">{observation.questionText}</p>
              <p className="break-words text-sm leading-6">{observation.answerText}</p>
              <p className="text-sm leading-6">{t("demoLine")}</p>
              <p className="text-sm leading-6 text-muted-foreground">{t("createdAt", { time: when.format(new Date(observation.createdAt)) })}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CreateForm({ brands, labelFor, selectedBrandId, t }: {
  brands: { id: string }[];
  labelFor: (brandId: string) => string;
  selectedBrandId: string;
  t: Translator;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const initialBrand = brands.some((brand) => brand.id === selectedBrandId) ? selectedBrandId : brands[0]?.id ?? "";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = createDemoObservationSchema.safeParse({
      operationId: crypto.randomUUID(),
      brandId: String(data.get("brandId") ?? ""),
      questionText: String(data.get("questionText") ?? ""),
      answerText: String(data.get("answerText") ?? ""),
    });
    if (!parsed.success) {
      setNotice(t("INVALID_INPUT"));
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/monitoring/demo-observations", {
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
      const saved = await response.json();
      if (!saved || typeof saved !== "object" || !("observation" in saved) || !saved.observation || saved.observation.is_demo !== true) {
        setNotice(t("SERVICE_UNAVAILABLE"));
        return;
      }
      setNotice(t("saved"));
      form.reset();
      router.push(`${returnPath}?brandId=${parsed.data.brandId}`);
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="min-w-0 space-y-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">{t("registerTitle")}</h2>
        <Badge variant="outline">{t("demoBadge")}</Badge>
      </div>
      {notice ? <p role="status" className="text-sm leading-6">{notice}</p> : null}
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("brand")}</span>
        <select className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm" name="brandId" defaultValue={initialBrand}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{labelFor(brand.id)}</option>)}
        </select>
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("question")}</span>
        <textarea className={fieldClass} name="questionText" required maxLength={4000} rows={3} />
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("answer")}</span>
        <textarea className={fieldClass} name="answerText" required maxLength={8000} rows={4} />
      </label>
      <p className="text-sm leading-6 text-muted-foreground">{t("notVerified")}</p>
      <Button type="submit" disabled={pending}>{pending ? t("registering") : t("registerAction")}</Button>
    </form>
  );
}

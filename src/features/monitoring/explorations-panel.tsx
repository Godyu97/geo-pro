"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import {
  createExplorationSchema,
  explorationErrors,
  explorationExclusionReason,
  type ExplorationError,
  type ExplorationObservationView,
} from "./exploration-contracts.ts";

type Copy = Messages["explorations"];
type Translator = (key: keyof Copy, params?: Record<string, string | number>) => string;

const fieldClass = "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";
const returnPath = "/dashboard/monitoring/explorations";

function isExplorationError(code: string): code is ExplorationError {
  return Object.hasOwn(explorationErrors, code);
}

function noticeFrom(payload: unknown, t: Translator) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return t("SERVICE_UNAVAILABLE");
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return t("SERVICE_UNAVAILABLE");
  return isExplorationError(error.code) ? t(error.code) : t("SERVICE_UNAVAILABLE");
}

export function ExplorationsPanel({ brands, observations, labels, selectedBrandId, idle, messages }: {
  brands: { id: string }[];
  observations: ExplorationObservationView[];
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
      {brands.length === 0 ? <p className="rounded-xl border border-dashed bg-card p-4 text-sm leading-6 text-muted-foreground">{t("noBrands")}</p> : (
        <CreateForm brands={brands} labelFor={labelFor} selectedBrandId={selectedBrandId} t={t} />
      )}
      {idle && brands.length > 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("pickBrand")}</p> : null}
      {selectedBrandId && observations.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("empty")}</p> : null}
      {observations.length > 0 ? (
        <ul id="exploration-observations" tabIndex={-1} aria-label={t("viewObservations")}
          className="scroll-mt-5 space-y-3 rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
          {observations.map((observation) => (
            <li key={observation.id} className="min-w-0 space-y-2 rounded-xl border bg-card p-5">
              <p className="wrap-anywhere whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{labelFor(observation.brandId)}</p>
              <p className="wrap-anywhere whitespace-pre-wrap text-sm leading-6">{observation.questionText}</p>
              <p className="wrap-anywhere whitespace-pre-wrap text-sm leading-6">{observation.answerText}</p>
              <p className="text-sm leading-6">{t("reason")} {t("reasonValue")}</p>
              <p className="text-sm leading-6">{t("excludedLine")}</p>
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
    const parsed = createExplorationSchema.safeParse({
      operationId: crypto.randomUUID(),
      brandId: String(data.get("brandId") ?? ""),
      questionText: String(data.get("questionText") ?? ""),
      answerText: String(data.get("answerText") ?? ""),
      exclusionReason: explorationExclusionReason,
    });
    if (!parsed.success) {
      setNotice(t("INVALID_INPUT"));
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/monitoring/explorations", {
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
      <h2 className="font-medium">{t("registerTitle")}</h2>
      {notice ? <p role="status" className="text-sm leading-6">{notice}</p> : null}
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("brand")}</span>
        <select className={fieldClass} name="brandId" defaultValue={initialBrand}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{labelFor(brand.id)}</option>)}
        </select>
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("question")}</span>
        <textarea id="exploration-question" className={`${fieldClass} scroll-mt-5`} name="questionText" required maxLength={4000} rows={3} />
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("answer")}</span>
        <textarea className={fieldClass} name="answerText" required maxLength={8000} rows={4} />
      </label>
      <p className="text-sm leading-6 text-muted-foreground">{t("reason")} {t("reasonValue")}. {t("reasonHint")}</p>
      <Button type="submit" disabled={pending}>{pending ? t("registering") : t("registerAction")}</Button>
    </form>
  );
}

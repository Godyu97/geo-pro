"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import {
  crawlerVisitErrors,
  registerCrawlerVisitSchema,
  type CrawlerObservationView,
  type CrawlerVisitError,
} from "./crawler-contracts.ts";

type Copy = Messages["crawlerVisits"];
type Translator = (key: keyof Copy, params?: Record<string, string | number>) => string;

const selectClass = "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm";
const returnPath = "/dashboard/reports/crawler-visits";

function isCrawlerVisitError(code: string): code is CrawlerVisitError {
  return Object.hasOwn(crawlerVisitErrors, code);
}

function noticeFrom(payload: unknown, t: Translator) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return t("SERVICE_UNAVAILABLE");
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return t("SERVICE_UNAVAILABLE");
  return isCrawlerVisitError(error.code) ? t(error.code) : t("SERVICE_UNAVAILABLE");
}

function booleanField(value: FormDataEntryValue | null) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

export function CrawlerVisitsPanel({ brands, observations, labels, messages }: {
  brands: { id: string }[];
  observations: CrawlerObservationView[];
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
          {observations.map((observation) => (
            <li key={observation.id} className="min-w-0 space-y-2 rounded-xl border bg-card p-5">
              <p className="break-words font-medium">{labelFor(observation.brandId)}</p>
              <p className="text-sm leading-6">{observation.identity === "verified" ? t("identityVerified") : t("identityUnverified")}</p>
              <p className="text-sm leading-6 text-muted-foreground">{t("citationsLine", { count: observation.citations })}</p>
              <p className="text-sm leading-6 text-muted-foreground">{t("observedAt", { time: when.format(new Date(observation.observedAt)) })}</p>
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
    const rawCitations = String(data.get("answerCitations") ?? "").trim();
    const parsed = registerCrawlerVisitSchema.safeParse({
      brandId: String(data.get("brandId") ?? ""),
      userAgentClaimsAi: booleanField(data.get("userAgentClaimsAi")),
      identityVerified: booleanField(data.get("identityVerified")),
      answerCitations: /^(?:0|[1-9]\d*)$/.test(rawCitations) ? Number(rawCitations) : rawCitations,
    });
    if (!parsed.success) {
      setNotice(t("INVALID_INPUT"));
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/reports/crawler-visits", {
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
        <select name="brandId" required className={selectClass} defaultValue={brands[0]?.id}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{labelFor(brand.id)}</option>)}
        </select>
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("claim")}</span>
        <select name="userAgentClaimsAi" required className={selectClass} defaultValue="true">
          <option value="true">{t("claimsYes")}</option>
          <option value="false">{t("claimsNo")}</option>
        </select>
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("verification")}</span>
        <select name="identityVerified" required className={selectClass} defaultValue="false">
          <option value="false">{t("verifiedNo")}</option>
          <option value="true">{t("verifiedYes")}</option>
        </select>
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("citations")}</span>
        <input
          name="answerCitations"
          type="number"
          required
          min={0}
          max={1000000000}
          step={1}
          defaultValue={0}
          inputMode="numeric"
          autoComplete="off"
          className={selectClass}
        />
        <span className="block text-muted-foreground">{t("citationsHint")}</span>
      </label>
      <Button type="submit" disabled={pending}>{pending ? t("registering") : t("registerAction")}</Button>
    </form>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import { formatNumber } from "@/lib/i18n/format";
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

const selectClass = "min-h-10 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";
const returnPath = "/dashboard/reports/crawler-visits";

function isCrawlerVisitError(code: string): code is CrawlerVisitError {
  return Object.hasOwn(crawlerVisitErrors, code);
}

function errorFrom(payload: unknown): CrawlerVisitError {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return "SERVICE_UNAVAILABLE";
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return "SERVICE_UNAVAILABLE";
  return isCrawlerVisitError(error.code) ? error.code : "SERVICE_UNAVAILABLE";
}

function booleanField(value: FormDataEntryValue | null) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

export function CrawlerVisitsPanel({ brands, observations, labels, brandFieldId, messages }: {
  brands: { id: string }[];
  observations: CrawlerObservationView[];
  labels: { brandId: string; name: string }[];
  brandFieldId: string;
  messages: Copy;
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const labelFor = (brandId: string) => labels.find((label) => label.brandId === brandId)?.name ?? brandId;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

  return (
    <>
      {brands.length > 0 ? (
        <>
          {observations.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-card px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
          ) : null}
          <RegisterForm brands={brands} labelFor={labelFor} brandFieldId={brandFieldId} t={t} />
        </>
      ) : null}
      {observations.length > 0 ? (
        <section aria-labelledby="crawler-visit-observations" className="min-w-0 space-y-3">
          <h2 id="crawler-visit-observations" className="text-lg font-semibold">{t("observationsTitle")}</h2>
          <ul className="space-y-3">
            {observations.map((observation) => (
              <li key={observation.id} className="min-w-0 space-y-2 rounded-xl border bg-card p-4 [overflow-wrap:anywhere]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 font-medium">{labelFor(observation.brandId)}</p>
                  <Badge variant={observation.identity === "verified" ? "secondary" : "outline"}>
                    {t(observation.identity === "verified" ? "identityVerified" : "identityUnverified")}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {t("citationsLine", { count: formatNumber(locale, observation.citations) })}
                </p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {t("observedAt", { time: when.format(new Date(observation.observedAt)) })}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function RegisterForm({ brands, labelFor, brandFieldId, t }: {
  brands: { id: string }[];
  labelFor: (brandId: string) => string;
  brandFieldId: string;
  t: Translator;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<CrawlerVisitError | "saved" | null>(null);

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
      setNotice("INVALID_INPUT");
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
    <form onSubmit={submit} aria-labelledby="crawler-visit-register" className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
      <h2 id="crawler-visit-register" className="text-lg font-semibold">{t("registerTitle")}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block min-w-0 space-y-1 text-sm">
          <span>{t("brand")}</span>
          <select id={brandFieldId} name="brandId" required className={`${selectClass} scroll-mt-20`} defaultValue={brands[0]?.id}>
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
        <div className="min-w-0 space-y-1 text-sm">
          <label htmlFor="crawler-visit-citations">{t("citations")}</label>
          <Input
            id="crawler-visit-citations"
            name="answerCitations"
            type="number"
            required
            min={0}
            max={1000000000}
            step={1}
            defaultValue={0}
            inputMode="numeric"
            autoComplete="off"
            aria-describedby="crawler-visit-citations-hint"
            className="h-10"
          />
          <p id="crawler-visit-citations-hint" className="text-muted-foreground">{t("citationsHint")}</p>
        </div>
      </div>
      <Button type="submit" aria-disabled={pending} className="h-auto min-h-10 max-w-full py-2 whitespace-normal aria-disabled:opacity-50">
        {pending ? t("registering") : t("registerAction")}
      </Button>
      <p role="status" className={notice === "saved" ? "text-sm leading-6" : "sr-only"}>
        {pending ? t("registering") : notice === "saved" ? t("saved") : null}
      </p>
      {notice && notice !== "saved" ? <p role="alert" className="text-sm leading-6 text-destructive">{t(notice)}</p> : null}
    </form>
  );
}

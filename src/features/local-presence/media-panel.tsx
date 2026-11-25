"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import {
  mediaReviewErrors,
  recordMediaReviewSchema,
  type ApprovedFactOption,
  type MediaReason,
  type MediaReviewError,
  type MediaReviewView,
} from "./media-contracts.ts";

type Copy = Messages["mediaReviews"];
type Translator = (key: keyof Copy, params?: Record<string, string | number>) => string;

const fieldClass = "block min-h-9 w-full min-w-0 scroll-mt-24 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";
const returnPath = "/dashboard/content/media-reviews";

const reasonKey = {
  ok: "reasonOk",
  fact_mismatch: "reasonFactMismatch",
  not_proof: "reasonNotProof",
} as const satisfies Record<MediaReason, keyof Copy>;

function isMediaReviewError(code: string): code is MediaReviewError {
  return Object.hasOwn(mediaReviewErrors, code);
}

function noticeFrom(payload: unknown): MediaReviewError {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return "SERVICE_UNAVAILABLE";
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return "SERVICE_UNAVAILABLE";
  return isMediaReviewError(error.code) ? error.code : "SERVICE_UNAVAILABLE";
}

export function MediaReviewsPanel({ brands, facts, reviews, labels, messages, initialBrandId }: {
  brands: { id: string }[];
  facts: ApprovedFactOption[];
  reviews: MediaReviewView[];
  labels: { brandId: string; name: string }[];
  messages: Copy;
  initialBrandId: string | null;
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const labelFor = (brandId: string) => labels.find((label) => label.brandId === brandId)?.name ?? brandId;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const kindLabel = (kind: MediaReviewView["kind"]) => kind === "image" ? t("kindImage") : t("kindScript");

  return (
    <div className="min-w-0 space-y-6">
      {brands.length > 0 && (
        <RegisterForm
          brands={brands}
          facts={facts}
          labelFor={labelFor}
          t={t}
          initialBrandId={initialBrandId}
        />
      )}
      {(brands.length > 0 || reviews.length > 0) && (
        <section id="media-check-history" tabIndex={-1} aria-labelledby="media-check-history-title" className="min-w-0 scroll-mt-24 space-y-3 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <h2 id="media-check-history-title" className="text-base font-semibold">{t("historyTitle")}</h2>
          {reviews.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-card p-4 text-sm leading-6 text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="space-y-3">
              {reviews.map((review) => (
                <li key={review.id} className="min-w-0">
                  <Card className="min-w-0 [overflow-wrap:anywhere]">
                    <CardHeader>
                      <h3 className="font-medium">{kindLabel(review.kind)}</h3>
                      <p className="text-muted-foreground">{labelFor(review.brandId)}</p>
                      <p className={cn("font-medium", review.deliver ? "text-foreground" : "text-destructive")}>
                        {review.deliver ? t("deliverAllowed") : t("deliverBlocked")}
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-2 leading-6">
                      <p>{t("shownLine", { value: review.shownValue })}</p>
                      <p>{t("approvedLine", { value: review.approvedValue })}</p>
                      <p>{t("reasonLine", { reason: t(reasonKey[review.reason]) })}</p>
                      <p>{t("factLine", { id: review.factVersionId })}</p>
                      <p className="text-muted-foreground">{t("recordedAt", { time: when.format(new Date(review.recordedAt)) })}</p>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function RegisterForm({ brands, facts, labelFor, t, initialBrandId }: {
  brands: { id: string }[];
  facts: ApprovedFactOption[];
  labelFor: (brandId: string) => string;
  t: Translator;
  initialBrandId: string | null;
}) {
  const router = useRouter();
  const [brandId, setBrandId] = useState(initialBrandId ?? brands[0]?.id ?? "");
  const [factId, setFactId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [notice, setNotice] = useState<MediaReviewError | "savedOk" | "savedBlocked" | null>(null);
  const factsForBrand = facts.filter((fact) => fact.brandId === brandId);
  const selectedFact = factsForBrand.find((fact) => fact.id === factId) ?? factsForBrand[0];
  const saved = notice === "savedOk" || notice === "savedBlocked";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = recordMediaReviewSchema.safeParse({
      brandId: String(data.get("brandId") ?? ""),
      kind: String(data.get("kind") ?? ""),
      shownValue: String(data.get("shownValue") ?? ""),
      factVersionId: String(data.get("factVersionId") ?? ""),
      presentedAsCustomerProof: data.get("presentedAsCustomerProof") === "on",
    });
    if (!parsed.success) {
      setNotice("INVALID_INPUT");
      return;
    }
    submitting.current = true;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/content/media-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath(returnPath, "session-required"));
          return;
        }
        setNotice(noticeFrom(await response.json()));
        return;
      }
      const payload: unknown = await response.json();
      const review = payload && typeof payload === "object" && "review" in payload ? payload.review : null;
      if (!review || typeof review !== "object" || !("deliver" in review) || typeof review.deliver !== "boolean") {
        setNotice("SERVICE_UNAVAILABLE");
        return;
      }
      setNotice(review.deliver ? "savedOk" : "savedBlocked");
      form.reset();
      setFactId(null);
      router.refresh();
    } catch {
      setNotice("SERVICE_UNAVAILABLE");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <h2 className="text-base font-semibold">{t("registerTitle")}</h2>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="min-w-0 space-y-4">
          {notice && <p role={saved ? "status" : "alert"} className={cn("text-sm leading-6", !saved && "text-destructive")}>{t(notice)}</p>}
          <div className="min-w-0 space-y-1 text-sm">
            <label htmlFor="media-check-brand">{t("brand")}</label>
            <select id="media-check-brand" name="brandId" required disabled={pending} className={fieldClass} value={brandId} onChange={(event) => {
              setBrandId(event.target.value);
              setFactId(null);
            }}>
              {brands.map((brand) => <option key={brand.id} value={brand.id}>{labelFor(brand.id)}</option>)}
            </select>
          </div>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{labelFor(brandId)}</p>
          <div className="min-w-0 space-y-1 text-sm">
            <label htmlFor="media-check-kind">{t("kind")}</label>
            <select id="media-check-kind" name="kind" required disabled={pending} className={fieldClass} defaultValue="image">
              <option value="image">{t("kindImage")}</option>
              <option value="script">{t("kindScript")}</option>
            </select>
          </div>
          {!selectedFact ? <p className="text-sm leading-6 text-muted-foreground">{t("noFacts")}</p> : (
            <div className="min-w-0 space-y-1 text-sm">
              <label htmlFor="media-check-fact">{t("fact")}</label>
              <select id="media-check-fact" name="factVersionId" required disabled={pending} className={fieldClass} value={selectedFact.id} onChange={(event) => setFactId(event.target.value)} aria-describedby="media-check-fact-hint">
                {factsForBrand.map((fact) => (
                  <option key={fact.id} value={fact.id}>{`v${fact.version}: ${Array.from(fact.approvedValue).slice(0, 80).join("")}`}</option>
                ))}
              </select>
              <p id="media-check-fact-hint" className="text-muted-foreground">{t("factHint")}</p>
              <p className="rounded-lg bg-muted p-3 leading-6 [overflow-wrap:anywhere]">{t("approvedLine", { value: selectedFact.approvedValue })}</p>
            </div>
          )}
          <div className="min-w-0 space-y-1 text-sm">
            <label htmlFor="media-check-shown">{t("shownValue")}</label>
            <textarea id="media-check-shown" name="shownValue" required readOnly={pending} maxLength={4000} rows={4} autoComplete="off" className={fieldClass} aria-describedby="media-check-shown-hint" />
            <p id="media-check-shown-hint" className="text-muted-foreground">{t("shownHint")}</p>
          </div>
          <label className="flex min-w-0 items-start gap-2 text-sm leading-6">
            <input name="presentedAsCustomerProof" type="checkbox" disabled={pending} className="mt-1 accent-primary focus-visible:ring-3 focus-visible:ring-ring/50" />
            <span>
              <span className="block">{t("proof")}</span>
              <span className="block text-muted-foreground">{t("proofHint")}</span>
            </span>
          </label>
          <Button type="submit" disabled={!selectedFact} aria-disabled={pending || undefined} className="h-auto min-h-9 max-w-full whitespace-normal">
            {pending ? t("registering") : t("registerAction")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

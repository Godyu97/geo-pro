"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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

const fieldClass = "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm";
const returnPath = "/dashboard/content/media-reviews";

const reasonKey = {
  ok: "reasonOk",
  fact_mismatch: "reasonFactMismatch",
  not_proof: "reasonNotProof",
} as const satisfies Record<MediaReason, keyof Copy>;

function isMediaReviewError(code: string): code is MediaReviewError {
  return Object.hasOwn(mediaReviewErrors, code);
}

function noticeFrom(payload: unknown, t: Translator) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return t("SERVICE_UNAVAILABLE");
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return t("SERVICE_UNAVAILABLE");
  return isMediaReviewError(error.code) ? t(error.code) : t("SERVICE_UNAVAILABLE");
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
    <div className="space-y-6">
      {brands.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("noBrands")}</p> : (
        <RegisterForm
          brands={brands}
          facts={facts}
          labelFor={labelFor}
          t={t}
          initialBrandId={brands.some((brand) => brand.id === initialBrandId) ? initialBrandId : brands[0]?.id ?? null}
        />
      )}
      {reviews.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("empty")}</p> : (
        <ul className="space-y-3">
          {reviews.map((review) => (
            <li key={review.id} className="min-w-0 space-y-2 rounded-xl border bg-card p-5">
              <p className="text-sm leading-6 text-muted-foreground">{labelFor(review.brandId)}</p>
              <p className="text-sm font-medium">{kindLabel(review.kind)}</p>
              <p className="break-words text-sm leading-6">{t("shownLine", { value: review.shownValue })}</p>
              <p className="break-words text-sm leading-6">{t("approvedLine", { value: review.approvedValue })}</p>
              <p className="break-words text-sm leading-6">{t("reasonLine", { reason: t(reasonKey[review.reason]) })}</p>
              <p className="break-all text-sm leading-6">{t("factLine", { id: review.factVersionId })}</p>
              <p className="text-sm leading-6">{review.deliver ? t("deliverAllowed") : t("deliverBlocked")}</p>
              <p className="text-sm leading-6 text-muted-foreground">{t("recordedAt", { time: when.format(new Date(review.recordedAt)) })}</p>
            </li>
          ))}
        </ul>
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
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const factsForBrand = facts.filter((fact) => fact.brandId === brandId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
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
      setNotice(t("INVALID_INPUT"));
      return;
    }
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
        setNotice(noticeFrom(await response.json(), t));
        return;
      }
      const payload: unknown = await response.json();
      const deliver = payload && typeof payload === "object" && "review" in payload
        && payload.review && typeof payload.review === "object" && "deliver" in payload.review
        && payload.review.deliver === true;
      setNotice(deliver ? t("savedOk") : t("savedBlocked"));
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
        <select name="brandId" required className={fieldClass} value={brandId} onChange={(event) => setBrandId(event.target.value)}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{labelFor(brand.id)}</option>)}
        </select>
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("kind")}</span>
        <select name="kind" required className={fieldClass} defaultValue="image">
          <option value="image">{t("kindImage")}</option>
          <option value="script">{t("kindScript")}</option>
        </select>
      </label>
      {factsForBrand.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("noFacts")}</p> : (
        <label className="block min-w-0 space-y-1 text-sm">
          <span>{t("fact")}</span>
          <select key={brandId} name="factVersionId" required className={fieldClass} defaultValue={factsForBrand[0]?.id}>
            {factsForBrand.map((fact) => (
              <option key={fact.id} value={fact.id}>{`v${fact.version}: ${fact.approvedValue.slice(0, 80)}`}</option>
            ))}
          </select>
          <span className="block text-muted-foreground">{t("factHint")}</span>
        </label>
      )}
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("shownValue")}</span>
        <textarea name="shownValue" required maxLength={4000} rows={4} autoComplete="off" className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm" />
        <span className="block text-muted-foreground">{t("shownHint")}</span>
      </label>
      <label className="flex min-w-0 items-start gap-2 text-sm leading-6">
        <input name="presentedAsCustomerProof" type="checkbox" className="mt-1" />
        <span>
          <span className="block">{t("proof")}</span>
          <span className="block text-muted-foreground">{t("proofHint")}</span>
        </span>
      </label>
      <Button type="submit" disabled={pending || factsForBrand.length === 0}>{pending ? t("registering") : t("registerAction")}</Button>
    </form>
  );
}

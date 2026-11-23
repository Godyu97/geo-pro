"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import {
  draftIndustryPackQuestionsSchema,
  industryPackErrors,
  registerIndustryPackSchema,
  type IndustryPackError,
  type IndustryPackStatus,
  type IndustryPackView,
} from "./industry-pack-contracts.ts";

type Copy = Messages["industryPacks"];
type Translator = (key: keyof Copy, params?: Record<string, string | number>) => string;

const fieldClass = "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm";
const areaClass = "min-h-24 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm";
const returnPath = "/dashboard/brands/industry-packs";

const statusKey: Record<IndustryPackStatus, keyof Copy> = {
  draft: "statusDraft",
  reviewed: "statusReviewed",
  available: "statusAvailable",
  retired: "statusRetired",
};

function isIndustryPackError(code: string): code is IndustryPackError {
  return Object.hasOwn(industryPackErrors, code);
}

function noticeFrom(payload: unknown, t: Translator) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return t("SERVICE_UNAVAILABLE");
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return t("SERVICE_UNAVAILABLE");
  return isIndustryPackError(error.code) ? t(error.code) : t("SERVICE_UNAVAILABLE");
}

export function IndustryPacksPanel({ brands, packs, labels, messages }: {
  brands: { id: string }[];
  packs: IndustryPackView[];
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
      {packs.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("empty")}</p> : (
        <ul className="space-y-3">
          {packs.map((pack) => (
            <li key={pack.id} className="min-w-0 space-y-3 rounded-xl border bg-card p-5">
              <p className="break-words text-sm leading-6 text-muted-foreground">{labelFor(pack.brandId)}</p>
              <p className="break-words text-sm leading-6">{t("scopeLine", { scope: pack.scope })}</p>
              <p className="text-sm leading-6">{pack.coversRegulated ? t("coversRegulated") : t("coversGeneral")}</p>
              <p className="text-sm leading-6">{t("statusLine", { status: t(statusKey[pack.status]) })}</p>
              <p className="text-sm leading-6 text-muted-foreground">{t("createdAt", { time: when.format(new Date(pack.createdAt)) })}</p>
              <DraftForm packId={pack.id} t={t} />
              {pack.questions.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("questionEmpty")}</p> : (
                <ul className="space-y-2">
                  {pack.questions.map((question) => (
                    <li key={question.id} className="min-w-0 space-y-1 rounded-lg border p-3">
                      <p className="break-words text-sm leading-6">{question.body}</p>
                      <p className="text-sm leading-6 text-muted-foreground">{t("questionDraft")}</p>
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
    const parsed = registerIndustryPackSchema.safeParse({
      brandId: String(data.get("brandId") ?? ""),
      scope: String(data.get("scope") ?? ""),
      coversRegulated: data.get("coversRegulated") === "on",
    });
    if (!parsed.success) {
      setNotice(t("INVALID_INPUT"));
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/brands/industry-packs", {
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
        <span>{t("scope")}</span>
        <input name="scope" type="text" required maxLength={400} autoComplete="off" className={fieldClass} />
        <span className="block text-muted-foreground">{t("scopeHint")}</span>
      </label>
      <label className="flex min-w-0 items-start gap-2 text-sm leading-6">
        <input name="coversRegulated" type="checkbox" className="mt-1" />
        <span>{t("coversRegulatedLabel")}</span>
      </label>
      <Button type="submit" disabled={pending}>{pending ? t("registering") : t("registerAction")}</Button>
    </form>
  );
}

function DraftForm({ packId, t }: { packId: string; t: Translator }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = draftIndustryPackQuestionsSchema.safeParse({
      scenario: String(data.get("scenario") ?? ""),
      materials: String(data.get("materials") ?? ""),
    });
    if (!parsed.success) {
      setNotice(t("INVALID_INPUT"));
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/brands/industry-packs/${packId}/questions`, {
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
      setNotice(t("draftSaved"));
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
      <h3 className="text-sm font-medium">{t("draftTitle")}</h3>
      {notice && <p role="status" className="text-sm leading-6">{notice}</p>}
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("scenario")}</span>
        <select name="scenario" required className={fieldClass} defaultValue="general">
          <option value="general">{t("scenarioGeneral")}</option>
          <option value="regulated">{t("scenarioRegulated")}</option>
        </select>
        <span className="block text-muted-foreground">{t("scenarioHint")}</span>
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("materials")}</span>
        <textarea name="materials" required maxLength={4000} className={areaClass} />
        <span className="block text-muted-foreground">{t("materialsHint")}</span>
      </label>
      <Button type="submit" disabled={pending}>{pending ? t("drafting") : t("draftAction")}</Button>
    </form>
  );
}

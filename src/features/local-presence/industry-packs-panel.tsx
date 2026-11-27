"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import {
  draftIndustryPackQuestionsSchema,
  industryPackCommandSchema,
  industryPackErrors,
  registerIndustryPackSchema,
  type IndustryPackError,
  type IndustryPackCommand,
  type IndustryPackStatus,
  type IndustryPackView,
} from "./industry-pack-contracts.ts";
import { canAdoptIndustryPack, industryPackTransitions } from "./industry-pack.ts";

type Copy = Messages["industryPacks"];
type Translator = (key: keyof Copy, params?: Record<string, string | number>) => string;

const fieldClass = "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";
const actionClass = "h-auto min-h-10 max-w-full whitespace-normal py-2 text-center aria-disabled:opacity-60";

const statusKey: Record<IndustryPackStatus, keyof Copy> = {
  draft: "statusDraft",
  reviewed: "statusReviewed",
  available: "statusAvailable",
  retired: "statusRetired",
};
const transitionKey = {
  reviewed: "reviewAction", available: "availableAction", retired: "retireAction",
} as const;

function isIndustryPackError(code: string): code is IndustryPackError {
  return Object.hasOwn(industryPackErrors, code);
}

function noticeFrom(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return "SERVICE_UNAVAILABLE";
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return "SERVICE_UNAVAILABLE";
  return isIndustryPackError(error.code) ? error.code : "SERVICE_UNAVAILABLE";
}

export function IndustryPacksPanel({ brands, packs, labels, messages, hasBrands, returnPath }: {
  brands: { id: string }[];
  packs: IndustryPackView[];
  labels: { brandId: string; name: string }[];
  messages: Copy;
  hasBrands: boolean;
  returnPath: string;
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const labelFor = (brandId: string) => labels.find((label) => label.brandId === brandId)?.name ?? brandId;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

  if (!hasBrands) return null;

  return (
    <div className="min-w-0 space-y-6">
      {brands.length > 0 && (
        <RegisterForm brands={brands} labelFor={labelFor} t={t} returnPath={returnPath} />
      )}
      {packs.length === 0 ? <p className="rounded-xl border border-dashed bg-card p-4 text-sm leading-6 text-muted-foreground">{t("empty")}</p> : (
        <section id="industry-pack-list" aria-labelledby="industry-pack-list-title" tabIndex={-1}
          className="scroll-mt-5 space-y-3 rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
          <h2 id="industry-pack-list-title" className="font-medium">{t("savedPacks")}</h2>
          <ul className="space-y-3">
            {packs.map((pack) => (
              <li key={pack.id} className="min-w-0 space-y-3 rounded-xl border bg-card p-5">
                <p className="wrap-anywhere text-sm leading-6 text-muted-foreground">{labelFor(pack.brandId)}</p>
                <p className="wrap-anywhere text-sm leading-6">{t("scopeLine", { scope: pack.scope })}</p>
                <p className="text-sm leading-6">{pack.coversRegulated ? t("coversRegulated") : t("coversGeneral")}</p>
                <Badge variant="secondary" className="h-auto max-w-full whitespace-normal">{t("statusLine", { status: t(statusKey[pack.status]) })}</Badge>
                <p className="text-sm leading-6 text-muted-foreground">{t("createdAt", { time: when.format(new Date(pack.createdAt)) })}</p>
                {pack.canWrite && pack.status === "draft" && <DraftForm packId={pack.id} t={t} returnPath={returnPath} />}
                <PackQuestions pack={pack} t={t} returnPath={returnPath} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RegisterForm({ brands, labelFor, t, returnPath }: {
  brands: { id: string }[];
  labelFor: (brandId: string) => string;
  t: Translator;
  returnPath: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [notice, setNotice] = useState<IndustryPackError | "saved" | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = registerIndustryPackSchema.safeParse({
      brandId: String(data.get("brandId") ?? ""),
      scope: String(data.get("scope") ?? ""),
      coversRegulated: data.get("coversRegulated") === "on",
    });
    if (!parsed.success) {
      setNotice("INVALID_INPUT");
      return;
    }
    submitting.current = true;
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
        setNotice(noticeFrom(await response.json()));
        return;
      }
      setNotice("saved");
      form.reset();
      router.refresh();
    } catch {
      setNotice("SERVICE_UNAVAILABLE");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="min-w-0 space-y-4 rounded-xl border bg-card p-5">
      <h2 className="font-medium">{t("registerTitle")}</h2>
      {notice && (notice === "saved"
        ? <p role="status" className="text-sm leading-6">{t(notice)}</p>
        : <p role="alert" className="text-sm leading-6 text-destructive">{t(notice)}</p>)}
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("brand")}</span>
        <select name="brandId" required className={fieldClass} defaultValue={brands[0]?.id}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{labelFor(brand.id)}</option>)}
        </select>
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("scope")}</span>
        <Input id="industry-pack-scope" name="scope" type="text" required maxLength={400} autoComplete="off"
          aria-describedby="industry-pack-scope-hint" className="h-10 scroll-mt-5" />
      </label>
      <p id="industry-pack-scope-hint" className="text-sm text-muted-foreground">{t("scopeHint")}</p>
      <label className="flex min-w-0 items-start gap-2 text-sm leading-6">
        <input name="coversRegulated" type="checkbox" className="mt-1 accent-primary focus-visible:outline-2 focus-visible:outline-ring" />
        <span>{t("coversRegulatedLabel")}</span>
      </label>
      <Button type="submit" aria-disabled={pending} className={actionClass}>{pending ? t("registering") : t("registerAction")}</Button>
    </form>
  );
}

function DraftForm({ packId, t, returnPath }: { packId: string; t: Translator; returnPath: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [notice, setNotice] = useState<IndustryPackError | "draftSaved" | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = draftIndustryPackQuestionsSchema.safeParse({
      scenario: String(data.get("scenario") ?? ""),
      materials: String(data.get("materials") ?? ""),
    });
    if (!parsed.success) {
      setNotice("INVALID_INPUT");
      return;
    }
    submitting.current = true;
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
        setNotice(noticeFrom(await response.json()));
        return;
      }
      setNotice("draftSaved");
      form.reset();
      router.refresh();
    } catch {
      setNotice("SERVICE_UNAVAILABLE");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="min-w-0 space-y-3 rounded-lg border p-3">
      <h3 className="text-sm font-medium">{t("draftTitle")}</h3>
      {notice && (notice === "draftSaved"
        ? <p role="status" className="text-sm leading-6">{t(notice)}</p>
        : <p role="alert" className="text-sm leading-6 text-destructive">{t(notice)}</p>)}
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
        <textarea name="materials" required maxLength={4000} className={`${fieldClass} min-h-24`} />
        <span className="block text-muted-foreground">{t("materialsHint")}</span>
      </label>
      <Button type="submit" aria-disabled={pending} className={actionClass}>{pending ? t("drafting") : t("draftAction")}</Button>
    </form>
  );
}

function PackQuestions({ pack, t, returnPath }: { pack: IndustryPackView; t: Translator; returnPath: string }) {
  const router = useRouter();
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<IndustryPackError | "statusSaved" | "adopted" | "alreadyAdopted" | "selectQuestions" | null>(null);
  const [showSimilar, setShowSimilar] = useState(false);
  const canAdopt = pack.canWrite && canAdoptIndustryPack(pack.status) && pack.questions.length > 0;
  const transitions = (pack.canWrite ? industryPackTransitions[pack.status] : []).filter(
    (status) => status !== "reviewed" || pack.questions.length > 0,
  );
  const success = notice === "statusSaved" || notice === "adopted" || notice === "alreadyAdopted";

  async function send(command: IndustryPackCommand, form?: HTMLFormElement) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/brands/industry-packs/${pack.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      if (response.status === 401) {
        window.location.replace(loginPath(returnPath, "session-required"));
        return;
      }
      const payload: unknown = await response.json();
      if (!response.ok) {
        const error = noticeFrom(payload);
        setNotice(error);
        if (error === "DRAFT_SIMILAR") setShowSimilar(true);
        if (error === "STATUS_CONFLICT") router.refresh();
        return;
      }
      if (command.action === "transition") {
        setNotice("statusSaved");
      } else if (payload && typeof payload === "object" && "added" in payload && typeof payload.added === "number") {
        setNotice(payload.added > 0 ? "adopted" : "alreadyAdopted");
      } else {
        setNotice("SERVICE_UNAVAILABLE");
        return;
      }
      form?.reset();
      setShowSimilar(false);
      router.refresh();
    } catch {
      setNotice("SERVICE_UNAVAILABLE");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  function adopt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ids = data.getAll("questionId");
    if (!ids.length) {
      setNotice("selectQuestions");
      return;
    }
    const command = industryPackCommandSchema.safeParse({
      action: "adopt",
      scenario: data.get("adoptionScenario"),
      questionIds: ids,
      acceptSimilar: data.get("acceptSimilar") === "on",
    });
    if (!command.success) {
      setNotice("INVALID_INPUT");
      return;
    }
    void send(command.data, form);
  }

  const questions = pack.questions.length === 0
    ? <p className="text-sm leading-6 text-muted-foreground">{t("questionEmpty")}</p>
    : (
      <ul className="space-y-2">
        {pack.questions.map((question) => (
          <li key={question.id} className="min-w-0 space-y-1 rounded-lg border p-3">
            {canAdopt ? (
              <label className="flex min-w-0 items-start gap-2 text-sm leading-6">
                <input type="checkbox" name="questionId" value={question.id} className="mt-1 accent-primary" />
                <span className="wrap-anywhere">{question.body}</span>
              </label>
            ) : <p className="wrap-anywhere text-sm leading-6">{question.body}</p>}
            <p className="text-sm leading-6 text-muted-foreground">{t("questionDraft")}</p>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="min-w-0 space-y-3">
      {notice && <p role={success ? "status" : "alert"} className={success ? "text-sm" : "text-sm text-destructive"}>{t(notice)}</p>}
      {canAdopt ? (
        <form onSubmit={adopt} className="space-y-3">
          <fieldset disabled={pending} className="min-w-0 space-y-3">
            <legend className="mb-2 text-sm font-medium">{t("selectForDraft")}</legend>
            {questions}
            <label className="block min-w-0 space-y-1 text-sm">
              <span>{t("adoptionScenario")}</span>
              <select name="adoptionScenario" required className={fieldClass} defaultValue="">
                <option value="" disabled>{t("chooseScenario")}</option>
                <option value="general">{t("scenarioGeneral")}</option>
                <option value="regulated" disabled={!pack.coversRegulated}>{t("scenarioRegulated")}</option>
              </select>
            </label>
            {showSimilar && <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="acceptSimilar" className="mt-1 accent-primary" />
              {t("acceptSimilar")}
            </label>}
            <Button type="submit" disabled={pending} className={actionClass}>{t("adoptAction")}</Button>
          </fieldset>
        </form>
      ) : questions}
      <div className="flex flex-wrap gap-2">
        {transitions.map((to) => (
          <Button key={to} type="button" variant="outline" disabled={pending} className={actionClass}
            onClick={() => void send({ action: "transition", from: pack.status, to })}>
            {t(transitionKey[to])}
          </Button>
        ))}
        {canAdopt && <Button asChild variant="outline" className={actionClass}>
          <Link href={`/dashboard/brands/${pack.brandId}/questions`} prefetch={false}>{t("openPromptDraft")}</Link>
        </Button>}
      </div>
    </div>
  );
}

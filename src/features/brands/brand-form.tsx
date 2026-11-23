"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/lib/i18n/client";
import { formatNumber } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";
import {
  brandDraftFieldsSchema, brandFieldNameSchema, brandFieldsSchema, initialBrandFields,
  type BrandFieldName, type BrandFields, type BrandStep, type BrandTarget,
} from "./contracts";
import type { BrandDraft, RetentionPolicyRecord } from "./dao";
import { brandErrorMessage, brandFieldMessage } from "./error-messages";
import { useBrandMutation } from "./use-brand-mutation";

const steps = [
  { label: "stepBrand", fields: ["name", "description", "website", "aliases"] },
  { label: "stepScope", fields: ["region", "language", "competitors"] },
  { label: "stepQuestions", fields: ["questions"] },
] as const satisfies readonly { label: string; fields: readonly BrandFieldName[] }[];

const labels: Record<BrandFieldName, keyof Messages["brands"]> = {
  name: "fieldName", description: "fieldDescription", website: "fieldWebsite", aliases: "fieldAliases",
  region: "fieldRegion", language: "fieldLanguage", competitors: "fieldCompetitors", questions: "fieldQuestions",
};
const hints: Partial<Record<BrandFieldName, keyof Messages["brands"]>> = {
  website: "websiteHint", aliases: "aliasesHint", region: "regionHint", language: "languageHint",
  competitors: "competitorsHint", questions: "questionsHint",
};
const multiline = new Set<BrandFieldName>(["description", "aliases", "competitors", "questions"]);
const regionSuggestions = ["CN", "HK", "MO", "TW", "SG", "US", "GB", "JP", "KR", "DE", "FR", "AU"];
const languageSuggestions = ["zh-CN", "zh-TW", "en", "en-US", "ja", "ko", "de", "fr", "es"];

function formFields(fields: BrandFields) {
  return { ...fields, aliases: fields.aliases.join("\n"), competitors: fields.competitors.join("\n"), questions: fields.questions.join("\n") };
}

function lines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function stepFor(field: BrandFieldName): BrandStep {
  if (steps[0].fields.some((name) => name === field)) return 0;
  return steps[1].fields.some((name) => name === field) ? 1 : 2;
}

export function BrandForm({ actorId, draft, target, current, messages, mockProfile, policy = null }: {
  actorId: string;
  draft: BrandDraft | null;
  target: BrandTarget | null;
  current?: BrandFields;
  messages: Messages["brands"];
  mockProfile?: BrandFields;
  policy?: Pick<RetentionPolicyRecord, "version" | "summaryZh" | "summaryEn" | "recoverableDays"> | null;
}) {
  const { locale } = useLocale();
  const router = useRouter();
  const t = createTranslator(locale, messages);
  const { pending, error, send } = useBrandMutation(actorId);
  const [values, setValues] = useState(() => formFields(draft?.fields ?? current ?? initialBrandFields));
  const [step, setStep] = useState<BrandStep>(draft?.step ?? 0);
  const [expectedDraft, setExpectedDraft] = useState(draft?.version ?? null);
  const [invalid, setInvalid] = useState<BrandFieldName[]>([]);
  const [saved, setSaved] = useState(Boolean(draft));
  const [mockFilled, setMockFilled] = useState(false);
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);
  const [acceptRequired, setAcceptRequired] = useState(false);
  const focus = useRef<BrandFieldName | "heading" | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const composing = useRef(false);
  const staleDraft = Boolean(draft && target && draft.baseRevision !== target.expectedBrandRevision);
  const nextStep = step === 0 ? 1 : 2;
  const previousStep = step === 2 ? 1 : 0;
  const allErrors = [...new Set([...invalid, ...(error?.fields ?? [])])];

  useEffect(() => {
    if (focus.current === "heading") heading.current?.focus();
    else if (focus.current) document.getElementById("brand-" + focus.current)?.focus();
    focus.current = null;
  }, [step, invalid]);

  function showErrors(fields: BrandFieldName[]) {
    const first = fields[0];
    if (!first) return;
    focus.current = first;
    setInvalid(fields);
    setStep(stepFor(first));
  }

  function move(next: BrandStep) {
    focus.current = "heading";
    setStep(next);
  }

  async function save(intent: "draft" | "advance" | "submit") {
    if (composing.current || pending || staleDraft) return;
    const fields = { ...values, aliases: lines(values.aliases), competitors: lines(values.competitors), questions: lines(values.questions) };
    const parse = (intent === "draft" ? brandDraftFieldsSchema : brandFieldsSchema).safeParse(fields);
    if (!parse.success) {
      const problems = parse.error.issues.flatMap((issue) => {
        const name = brandFieldNameSchema.safeParse(issue.path[0]);
        return name.success && (intent !== "advance" || stepFor(name.data) === step) ? [name.data] : [];
      });
      if (problems.length) {
        showErrors(problems);
        return;
      }
    }
    setInvalid([]);
    setSaved(false);
    if (intent === "submit") {
      if (!target && (!policy || !acceptedPolicy)) {
        setAcceptRequired(true);
        return;
      }
      const result = await send({
        action: "submit", target, expectedDraft, fields,
        ...(target || !policy ? {} : { acceptedPolicyVersion: policy.version }),
      });
      if (result?.kind === "brand") router.replace("/dashboard/brands/" + result.id);
      return;
    }
    const result = await send({ action: "saveDraft", target, expectedDraft, fields, step: intent === "advance" ? nextStep : step });
    if (result?.kind === "draft") {
      setExpectedDraft(result.version);
      setSaved(true);
      if (intent === "advance") move(nextStep);
    }
  }

  async function discard() {
    if (!expectedDraft) return;
    const result = await send({ action: "discardDraft", brandId: target?.brandId ?? null, expectedDraft });
    if (result?.kind === "draft") window.location.reload();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(step === 2 ? "submit" : "advance");
  }

  return (
    <Card className="max-w-3xl py-0 shadow-none">
      <CardContent className="space-y-6 p-5 sm:p-7">
        <ol aria-label={t("steps")} className="grid grid-cols-3 gap-2 text-sm">
          {steps.map(({ label }, index) => (
            <li key={label} aria-current={index === step ? "step" : undefined}
              className={cn("min-w-0 break-words border-b-2 pb-2", index === step ? "border-primary font-semibold" : "border-border text-muted-foreground")}>
              {t(label)}
            </li>
          ))}
        </ol>
        <div className="space-y-2">
          <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold">{t(steps[step].label)}</h2>
          <p className="text-sm leading-6 text-muted-foreground">{t("draftHelp")}</p>
          {saved && <p role="status" className="text-sm font-medium">{t("draftSaved")}</p>}
          {mockFilled && <p role="status" className="text-sm font-medium">{t("mockProfileFilled")}</p>}
        </div>
        {staleDraft && <p role="alert" className="text-sm text-destructive">{t("staleDraft")}</p>}
        {!target && (
          <section aria-labelledby="brand-retention" data-retention-version={policy?.version ?? ""} className="space-y-3 rounded-lg border p-4">
            <h3 id="brand-retention" className="font-semibold">{t("retentionTitle")}</h3>
            {policy ? (
              <>
                <p className="text-sm">{t("retentionVersion", { version: formatNumber(locale, policy.version) })}</p>
                <p className="text-sm leading-6 text-muted-foreground">{t("retentionRecoverableDays", { days: formatNumber(locale, policy.recoverableDays) })}</p>
                <div className="space-y-1 text-sm leading-6">
                  <p className="font-medium">{t("retentionSummaryZh")}</p>
                  <p className="whitespace-pre-wrap text-muted-foreground">{policy.summaryZh}</p>
                </div>
                <div className="space-y-1 text-sm leading-6">
                  <p className="font-medium">{t("retentionSummaryEn")}</p>
                  <p className="whitespace-pre-wrap text-muted-foreground">{policy.summaryEn}</p>
                </div>
                <label className="flex items-start gap-2 text-sm leading-6" htmlFor="brand-retention-accept">
                  <input id="brand-retention-accept" className="mt-1" type="checkbox" checked={acceptedPolicy}
                    onChange={(event) => { setAcceptedPolicy(event.target.checked); setAcceptRequired(false); }} />
                  <span>{t("retentionAccept", { version: formatNumber(locale, policy.version) })}</span>
                </label>
              </>
            ) : <p className="text-sm leading-6">{t("retentionUnpublished")}</p>}
            {(acceptRequired || error?.code === "RETENTION_NOT_ACCEPTED" || error?.code === "RETENTION_UNPUBLISHED") && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {t(policy ? "retentionAcceptRequired" : "retentionUnpublished")}
              </p>
            )}
          </section>
        )}
        {error && (
          <div role="alert" className="space-y-2 text-sm">
            <p className="font-medium text-destructive">{t(brandErrorMessage[error.code])}</p>
            {(error.code === "VERSION_CONFLICT" || error.code === "OPERATION_CONFLICT" || error.code === "SESSION_CHANGED") &&
              <Button type="button" variant="outline" onClick={() => window.location.reload()}>{t("reload")}</Button>}
            {error.code === "LIMIT_REACHED" && <Link className="underline" href="/dashboard/brands">{t("archiveFirst")}</Link>}
          </div>
        )}
        <form method="post" noValidate onSubmit={submit} aria-busy={pending}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.nativeEvent.isComposing || composing.current) && event.target instanceof HTMLInputElement) {
              event.preventDefault();
            }
          }}>
          <fieldset disabled={pending || staleDraft} className="space-y-5">
            {steps[step].fields.map((field) => {
              const id = "brand-" + field;
              const hint = hints[field];
              const hasError = allErrors.includes(field);
              const props = {
                id,
                name: field,
                value: values[field],
                autoComplete: "off",
                "aria-invalid": hasError,
                "aria-describedby": [hint ? id + "-hint" : "", hasError ? id + "-error" : ""].filter(Boolean).join(" ") || undefined,
                onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                  const value = event.target.value;
                  setValues((prior) => ({ ...prior, [field]: value }));
                  setInvalid((prior) => prior.filter((name) => name !== field));
                  setSaved(false);
                },
              };
              return (
                <div key={field} className="space-y-2">
                  <Label htmlFor={id}>{t(labels[field])}</Label>
                  {hint && <p id={id + "-hint"} className="text-sm leading-6 text-muted-foreground">{t(hint)}</p>}
                  {multiline.has(field) ? (
                    <textarea {...props} rows={field === "questions" ? 5 : 3} className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs focus-visible:ring-2 focus-visible:ring-ring md:text-sm" />
                  ) : (
                    <Input {...props} type="text" inputMode={field === "website" ? "url" : undefined}
                      list={field === "region" || field === "language" ? id + "-choices" : undefined} />
                  )}
                  {field === "region" && <datalist id={id + "-choices"}>{regionSuggestions.map((value) => <option key={value} value={value} />)}</datalist>}
                  {field === "language" && <datalist id={id + "-choices"}>{languageSuggestions.map((value) => <option key={value} value={value} />)}</datalist>}
                  {hasError && <p id={id + "-error"} role="alert" className="text-sm font-medium text-destructive">{t(brandFieldMessage[field])}</p>}
                </div>
              );
            })}
            <div className="flex flex-wrap gap-2 pt-2">
              {mockProfile && (
                <Button type="button" variant="outline" onClick={() => {
                  setValues(formFields(mockProfile));
                  setInvalid([]);
                  setSaved(false);
                  setMockFilled(true);
                  focus.current = "heading";
                  setStep(0);
                }}>{t("applyMockProfile")}</Button>
              )}
              <Button type="submit" disabled={step === 2 && !target && !policy}>{t(step === 2 ? target ? "saveChanges" : "createBrand" : "next")}</Button>
              {step > 0 && <Button type="button" variant="outline" onClick={() => move(previousStep)}>{t("back")}</Button>}
              <Button type="button" variant="outline" onClick={() => void save("draft")}>{t("saveDraft")}</Button>
            </div>
          </fieldset>
          {pending && <p role="status" className="mt-3 text-sm">{t("saving")}</p>}
        </form>
        {expectedDraft && <Button type="button" variant="ghost" disabled={pending} onClick={() => void discard()}>{t("discardDraft")}</Button>}
      </CardContent>
    </Card>
  );
}

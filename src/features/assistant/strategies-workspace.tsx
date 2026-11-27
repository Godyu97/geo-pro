"use client";

import { useRef, useState, useTransition, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginPath } from "@/lib/auth/return-to";
import { formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import {
  draftStrategyTemplateSchema,
  saveStrategyTemplateSchema,
  strategyTemplateErrors,
  type StrategyTemplateError,
  type StrategyTemplateView,
} from "./strategy-contracts";
import { evidenceStrengths, type EvidenceStrength } from "./strategy-template";

type Copy = Messages["strategyTemplates"];
type Notice = { kind: "status" | "alert"; text: string };
type Fields = {
  industry: string;
  samplingCondition: string;
  successes: string;
  evidenceStrength: EvidenceStrength;
  failureCase: string;
  explanation: string;
  materials: string;
};

const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center aria-disabled:opacity-60";
const wrapBadgeClass = "h-auto max-w-full whitespace-normal rounded-xl px-3 py-1 text-left leading-5 [overflow-wrap:anywhere]";
const textClass = "min-h-28 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const selectClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const emptySurfaceClass = "rounded-xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground";
const fallbackPath = "/dashboard/assistant/strategies";

function emptyFields(): Fields {
  return {
    industry: "",
    samplingCondition: "",
    successes: "",
    evidenceStrength: "single_observation",
    failureCase: "",
    explanation: "",
    materials: "",
  };
}

function wholeNumber(value: string) {
  if (!/^\d{1,7}$/.test(value)) return Number.NaN;
  return Number(value);
}

function isStrength(value: string): value is EvidenceStrength {
  return evidenceStrengths.some((item) => item === value);
}

function isKnownError(code: string): code is StrategyTemplateError {
  return Object.hasOwn(strategyTemplateErrors, code);
}

function isSavedTemplate(value: unknown): value is StrategyTemplateView {
  if (!value || typeof value !== "object") return false;
  const row = value as StrategyTemplateView;
  return typeof row.id === "string"
    && row.label === "observation"
    && row.guaranteed === 0
    && typeof row.industry === "string"
    && typeof row.samplingCondition === "string"
    && typeof row.failureCase === "string"
    && typeof row.explanation === "string"
    && typeof row.successes === "number"
    && isStrength(row.evidenceStrength);
}

export function StrategyJump({ href, children, onClick, ...props }: ComponentProps<"a"> & { href: string; children: ReactNode }) {
  return (
    <a {...props} href={href} onClick={(event) => {
      onClick?.(event);
      const root = document.getElementById("main-content") ?? document;
      const target = root.querySelector<HTMLElement>(href);
      if (!target) return;
      event.preventDefault();
      target.focus();
      target.scrollIntoView({ block: "nearest" });
    }}>{children}</a>
  );
}

function NoticeBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <p
      role={notice.kind}
      className={notice.kind === "alert"
        ? "rounded-xl border border-destructive/30 bg-card px-4 py-3 text-sm leading-6 text-destructive"
        : "rounded-xl border bg-card px-4 py-3 text-sm leading-6 text-foreground"}
    >
      {notice.text}
    </p>
  );
}

function ObservationFields({
  idPrefix,
  values,
  onChange,
  t,
  note,
}: {
  idPrefix: string;
  values: Fields;
  onChange: (patch: Partial<Fields>) => void;
  t: (key: keyof Copy & string) => string;
  note: "explanation" | "materials";
}) {
  return (
    <>
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={`${idPrefix}-industry`}>{t("industry")}</Label>
        <Input
          id={`${idPrefix}-industry`}
          value={values.industry}
          maxLength={120}
          onChange={(event) => onChange({ industry: event.target.value })}
          className="h-10 bg-background"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={`${idPrefix}-successes`}>{t("successes")}</Label>
        <Input
          id={`${idPrefix}-successes`}
          value={values.successes}
          inputMode="numeric"
          maxLength={7}
          onChange={(event) => onChange({ successes: event.target.value })}
          className="h-10 bg-background tabular-nums"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-sampling`}>{t("samplingCondition")}</Label>
        <textarea
          id={`${idPrefix}-sampling`}
          value={values.samplingCondition}
          maxLength={500}
          onChange={(event) => onChange({ samplingCondition: event.target.value })}
          className={textClass}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={`${idPrefix}-strength`}>{t("evidenceStrength")}</Label>
        <select
          id={`${idPrefix}-strength`}
          value={values.evidenceStrength}
          onChange={(event) => {
            if (isStrength(event.target.value)) onChange({ evidenceStrength: event.target.value });
          }}
          className={selectClass}
        >
          {evidenceStrengths.map((strength) => (
            <option key={strength} value={strength}>{t(strength)}</option>
          ))}
        </select>
      </div>
      <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-failure`}>{t("failureCase")}</Label>
        <textarea
          id={`${idPrefix}-failure`}
          value={values.failureCase}
          maxLength={2000}
          onChange={(event) => onChange({ failureCase: event.target.value })}
          className={textClass}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-${note}`}>{t(note)}</Label>
        <textarea
          id={`${idPrefix}-${note}`}
          value={note === "explanation" ? values.explanation : values.materials}
          maxLength={4000}
          onChange={(event) => onChange(note === "explanation"
            ? { explanation: event.target.value }
            : { materials: event.target.value })}
          className={textClass}
        />
        {note === "materials" ? <p className="text-sm leading-6 text-muted-foreground">{t("materialsHint")}</p> : null}
      </div>
    </>
  );
}

export function StrategiesWorkspace({
  brandId,
  canWrite,
  locale,
  initialTemplates,
  messages,
  initialError,
}: {
  brandId: string;
  canWrite: boolean;
  locale: Locale;
  initialTemplates: StrategyTemplateView[];
  messages: Copy;
  initialError: StrategyTemplateError | null;
}) {
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const pathname = usePathname();
  const [templates, setTemplates] = useState(initialTemplates);
  const [saveFields, setSaveFields] = useState<Fields>(emptyFields);
  const [draftFields, setDraftFields] = useState<Fields>(emptyFields);
  const [notice, setNotice] = useState<Notice | null>(
    initialError ? { kind: "alert", text: t(initialError) } : null,
  );
  const [pending, setPending] = useState<"save" | "draft" | null>(null);
  const [, startTransition] = useTransition();
  const inFlightRef = useRef(false);
  const strengthLabel = {
    single_observation: t("single_observation"),
    repeated_observation: t("repeated_observation"),
    insufficient: t("insufficient"),
  } as const;

  function begin(key: "save" | "draft") {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    setPending(key);
    setNotice(null);
    return true;
  }

  function finish() {
    inFlightRef.current = false;
    setPending(null);
  }

  async function submit(path: string, body: unknown, onSuccess: (template: StrategyTemplateView) => void) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null) as
      | { template?: unknown; error?: { code?: string } }
      | null;
    if (!response.ok) {
      const code = payload && "error" in payload ? payload.error?.code : undefined;
      if (response.status === 401 || code === "SESSION_REQUIRED") {
        router.push(loginPath(pathname || fallbackPath, "session-required"));
        return;
      }
      setNotice({
        kind: "alert",
        text: typeof code === "string" && isKnownError(code) ? t(code) : t("SERVICE_UNAVAILABLE"),
      });
      return;
    }
    const template = payload && "template" in payload ? payload.template : undefined;
    if (!isSavedTemplate(template)) {
      setNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
      return;
    }
    onSuccess(template);
    router.refresh();
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlightRef.current) return;
    const command = saveStrategyTemplateSchema.safeParse({
      brandId,
      industry: saveFields.industry,
      samplingCondition: saveFields.samplingCondition,
      successes: wholeNumber(saveFields.successes),
      evidenceStrength: saveFields.evidenceStrength,
      failureCase: saveFields.failureCase,
      explanation: saveFields.explanation,
    });
    if (!command.success) {
      setNotice({ kind: "alert", text: t("INVALID_INPUT") });
      return;
    }
    if (!begin("save")) return;
    startTransition(async () => {
      try {
        await submit("/api/assistant/strategy-templates", command.data, (template) => {
          setTemplates((current) => [...current.filter((item) => item.id !== template.id), template]);
          setSaveFields(emptyFields());
          setNotice({ kind: "status", text: t("savedNotice") });
        });
      } catch {
        setNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
      } finally {
        finish();
      }
    });
  }

  function handleDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlightRef.current) return;
    const command = draftStrategyTemplateSchema.safeParse({
      brandId,
      industry: draftFields.industry,
      samplingCondition: draftFields.samplingCondition,
      successes: wholeNumber(draftFields.successes),
      evidenceStrength: draftFields.evidenceStrength,
      failureCase: draftFields.failureCase,
      materials: draftFields.materials,
    });
    if (!command.success) {
      setNotice({ kind: "alert", text: t("INVALID_INPUT") });
      return;
    }
    if (!begin("draft")) return;
    startTransition(async () => {
      try {
        await submit("/api/assistant/strategy-templates/draft", command.data, (template) => {
          setTemplates((current) => [...current.filter((item) => item.id !== template.id), template]);
          setDraftFields(emptyFields());
          setNotice({ kind: "status", text: t("draftedNotice") });
        });
      } catch {
        setNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
      } finally {
        finish();
      }
    });
  }

  return (
    <div className="min-w-0 space-y-6">
      <NoticeBanner notice={notice} />
      {canWrite ? (
        <>
          <Card id="strategy-save" className="min-w-0 scroll-mt-24">
            <CardHeader>
              <CardTitle>
                <h2 className="[overflow-wrap:anywhere]">{t("saveTitle")}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSave} className="grid min-w-0 gap-4 sm:grid-cols-2">
                <ObservationFields
                  idPrefix="strategy"
                  values={saveFields}
                  onChange={(patch) => setSaveFields((current) => ({ ...current, ...patch }))}
                  t={t}
                  note="explanation"
                />
                <div className="sm:col-span-2">
                  <Button type="submit" aria-disabled={pending === "save"} className={actionClass}>
                    {pending === "save" ? t("saving") : t("save")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card id="strategy-draft" className="min-w-0 scroll-mt-24">
            <CardHeader>
              <CardTitle>
                <h2 className="[overflow-wrap:anywhere]">{t("draftTitle")}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleDraft} className="grid min-w-0 gap-4 sm:grid-cols-2">
                <ObservationFields
                  idPrefix="strategy-draft"
                  values={draftFields}
                  onChange={(patch) => setDraftFields((current) => ({ ...current, ...patch }))}
                  t={t}
                  note="materials"
                />
                <div className="sm:col-span-2">
                  <Button type="submit" aria-disabled={pending === "draft"} className={actionClass}>
                    {pending === "draft" ? t("saving") : t("draft")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </>
      ) : null}

      {templates.length === 0 ? (
        <p className={emptySurfaceClass}>{t("empty")}</p>
      ) : (
        <div id="strategy-list" tabIndex={-1} className="min-w-0 scroll-mt-24 space-y-4 outline-none focus-visible:outline-2 focus-visible:outline-ring">
          <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">{t("listHeading")}</h2>
          {templates.map((template) => (
            <Card key={template.id} className="min-w-0">
              <CardHeader>
                <CardTitle>
                  <h3 className="[overflow-wrap:anywhere]">{template.industry}</h3>
                </CardTitle>
                <div className="flex min-w-0 flex-wrap gap-2">
                  <Badge variant="secondary" className={wrapBadgeClass}>{strengthLabel[template.evidenceStrength]}</Badge>
                  <Badge variant="outline" className={wrapBadgeClass}>{t("observation")}</Badge>
                  <Badge variant="outline" className={wrapBadgeClass}>{t("notGuaranteed")}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm leading-6 [overflow-wrap:anywhere]">{template.samplingCondition}</p>
                <p className="text-sm tabular-nums">{t("successLine", { count: formatNumber(locale, template.successes) })}</p>
                <p className="text-sm leading-6 [overflow-wrap:anywhere]">{template.failureCase}</p>
                <p className="text-sm leading-6 [overflow-wrap:anywhere]">{template.explanation}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

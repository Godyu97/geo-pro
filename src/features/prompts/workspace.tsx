"use client";

import { useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginPath } from "@/lib/auth/return-to";
import { formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { buyingStage, questionSource, questionStatus, questionType, type DraftContent, type PromptQuestion } from "./contracts";
import { cursorValue } from "./params";
import {
  activeQuestionLimit, professionalCategoryPreview, professionalTemplate, professionalTemplateNote,
} from "./professional-template";
import { annotateDraft } from "./rules";
import type { PromptWorkspace } from "./service";

type Copy = Messages["promptSets"];
type PendingAction = "saveDraft" | "freeze" | "generate" | "accept" | "dismiss" | null;
type StatusKind = "saved" | "info" | "error";

const controlClass = "w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const inputClass = "h-10 bg-background";
const actionClass = "h-auto min-h-9 max-w-full whitespace-normal text-center aria-disabled:opacity-60";
const wrapBadgeClass = "h-auto max-w-full whitespace-normal py-1 text-left leading-5 [overflow-wrap:anywhere]";
const checkboxClass = "mt-0.5 size-4 shrink-0 rounded border border-input accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const emptySurfaceClass = "rounded-xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <Label className="flex min-w-0 flex-col items-stretch gap-2">{label}{children}</Label>;
}

function emptyCluster() {
  return { id: crypto.randomUUID(), audience: "", intent: "", primaryPage: "", conversionAction: "" };
}

export function PromptWorkspaceView({ brandId, locale, data, messages }: {
  brandId: string; locale: Locale; data: PromptWorkspace; messages: Copy;
}) {
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const [content, setContent] = useState<DraftContent>(data.editor);
  const [suggestions, setSuggestions] = useState(data.suggestions);
  const [paste, setPaste] = useState("");
  const [notice, setNotice] = useState<{ kind: StatusKind; code: string | null; text: string } | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [pending, startTransition] = useTransition();
  const inFlightRef = useRef(false);
  const setId = useRef(data.familyId ?? "");
  const revision = useRef(data.draft?.revision ?? null);
  const baseSetId = useRef(data.draft?.baseSetId ?? null);
  const view = annotateDraft(content, data.terms);
  const activeCount = content.questions.filter((question) => question.status !== "inactive").length;
  const questionLimit = activeQuestionLimit(content.questions);
  const professional = content.questions.some((question) => question.sourceNote === professionalTemplateNote);
  const categories = professionalCategoryPreview(professional
    ? view.questions
    : professionalTemplate(data.brand.language).map((row) => ({ status: "candidate", type: row.type, brandTerm: false, primary: false })));
  const href = `/dashboard/brands/${brandId}/questions`;

  function updateQuestion(id: string, patch: Partial<PromptQuestion>) {
    setContent((current) => ({
      ...current,
      questions: current.questions.map((question) => question.id === id ? { ...question, ...patch } : question),
    }));
  }

  function loadProfessional() {
    if (data.readOnly || inFlightRef.current) return;
    const rows = professionalTemplate(data.brand.language);
    setContent((current) => {
      const clusters = current.clusters.length ? current.clusters : [emptyCluster()];
      return {
        clusters,
        questions: rows.map((row) => ({
          id: crypto.randomUUID(),
          clusterId: clusters[0].id,
          text: row.text,
          source: row.source,
          sourceNote: row.sourceNote,
          type: row.type,
          stage: row.stage,
          region: data.brand.region,
          language: data.brand.language,
          status: "candidate" as const,
          acceptSimilar: false,
          primary: false,
        })),
      };
    });
    setNotice({ kind: "info", code: "professionalLoaded", text: t("professionalLoaded") });
  }

  function trimNotice() {
    const code = questionLimit > 10 ? "professionalTrim" as const : "trim" as const;
    setNotice({ kind: "error", code, text: t(code) });
  }

  function addQuestion(question: Omit<PromptQuestion, "id" | "clusterId" | "primary" | "acceptSimilar" | "region" | "language"> & Partial<Pick<PromptQuestion, "region" | "language" | "acceptSimilar">>) {
    if (data.readOnly || inFlightRef.current) return;
    if (activeCount >= questionLimit) {
      trimNotice();
      return;
    }
    setContent((current) => {
      const clusters = current.clusters.length ? current.clusters : [emptyCluster()];
      return {
        clusters,
        questions: [...current.questions, {
          ...question,
          id: crypto.randomUUID(),
          clusterId: clusters[0].id,
          region: question.region ?? data.brand.region,
          language: question.language ?? data.brand.language,
          acceptSimilar: question.acceptSimilar ?? false,
          primary: false,
        }],
      };
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (data.readOnly || inFlightRef.current) return;
    const action = (event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : null)?.getAttribute("value") === "freeze"
      ? "freeze" : "saveDraft";
    if (action === "freeze" && !setId.current) setId.current = data.familyId ?? crypto.randomUUID();
    const command = action === "freeze"
      ? { action, id: crypto.randomUUID(), setId: setId.current, revision: revision.current, baseSetId: baseSetId.current, content }
      : { action, revision: revision.current, baseSetId: baseSetId.current, content };
    inFlightRef.current = true;
    setPendingAction(action);
    setNotice(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/brands/${brandId}/questions`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command),
        });
        const body = await response.json() as {
          error?: string; adjustments?: string[]; questionIds?: string[]; traceId?: string;
          content?: DraftContent; id?: string; revision?: number;
        };
        if (!response.ok || body.error) {
          const code = typeof body.error === "string" && Object.hasOwn(messages, body.error) ? body.error : "unavailable";
          const detail = body.adjustments?.map((item) => t(item as keyof Copy)).join(" ") ?? "";
          setNotice({ kind: "error", code, text: `${t(code as keyof Copy)}${detail ? ` ${detail}` : ""}` });
          return;
        }
        if (typeof body.revision === "number") revision.current = body.revision;
        if (body.content) setContent(body.content);
        setNotice({ kind: "saved", code: "saved", text: t("saved") });
        if (action === "freeze" && body.id) {
          baseSetId.current = body.id;
          router.push(`${href}?version=${body.id}`);
        }
      } catch {
        setNotice({ kind: "error", code: "unavailable", text: t("unavailable") });
      } finally {
        inFlightRef.current = false;
        setPendingAction(null);
      }
    });
  }

  function postSuggestion(command: { action: "generate"; promptSetId: string | null } | { action: "accept" | "dismiss"; id: string }) {
    if (data.readOnly || inFlightRef.current) return;
    inFlightRef.current = true;
    setPendingAction(command.action);
    setNotice(command.action === "generate" ? { kind: "info", code: "generatingSuggestions", text: t("generatingSuggestions") } : null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/brands/${brandId}/questions/suggestions`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command),
        });
        const body = await response.json() as {
          error?: string; traceId?: string; suggestions?: PromptWorkspace["suggestions"];
          discarded?: number; content?: DraftContent; revision?: number;
        };
        if (!response.ok || body.error) {
          const code = typeof body.error === "string" && Object.hasOwn(messages, body.error) ? body.error : "unavailable";
          setNotice({ kind: "error", code, text: `${t(code as keyof Copy)}${body.traceId ? ` ${body.traceId}` : ""}` });
          return;
        }
        if (command.action === "generate" && body.suggestions) {
          setSuggestions(body.suggestions);
          setNotice(body.discarded
            ? { kind: "info", code: "suggestionDiscarded", text: t("suggestionDiscarded", { count: formatNumber(locale, body.discarded) }) }
            : null);
          return;
        }
        if (command.action === "accept" && body.content && typeof body.revision === "number") {
          revision.current = body.revision;
          setContent(body.content);
          setSuggestions((current) => current.filter((item) => item.id !== command.id));
          setNotice({ kind: "saved", code: "suggestionAccepted", text: t("suggestionAccepted") });
          return;
        }
        if (command.action === "dismiss") {
          setSuggestions((current) => current.filter((item) => item.id !== command.id));
          setNotice({ kind: "info", code: "suggestionDismissed", text: t("suggestionDismissed") });
        }
      } catch {
        setNotice({ kind: "error", code: "unavailable", text: t("unavailable") });
      } finally {
        inFlightRef.current = false;
        setPendingAction(null);
      }
    });
  }

  return (
    <form aria-busy={pending} className="grid min-w-0 gap-5" onSubmit={submit}>
      {data.readOnly && (
        <p role="status" className="rounded-lg border bg-card p-3 text-sm leading-6">
          {t("readOnly")}
        </p>
      )}
      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={notice.kind === "error"
            ? "flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-card p-3 text-sm leading-6 text-destructive [overflow-wrap:anywhere]"
            : "flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-sm leading-6 [overflow-wrap:anywhere]"}
        >
          <span className="min-w-0 flex-1">{notice.text}</span>
          {notice.code === "signIn" && (
            <Link className="underline underline-offset-4" href={loginPath(href, "session-required")}>
              {t("signIn")}
            </Link>
          )}
          {(notice.code === "conflict" || notice.code === "unavailable") && (
            <Button type="button" size="sm" variant="outline" className={actionClass} onClick={() => router.refresh()}>
              {t("refresh")}
            </Button>
          )}
        </div>
      )}

      <section aria-labelledby="prompt-summary">
        <Card className="min-w-0 py-0 shadow-none">
          <CardContent className="space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="prompt-summary" className="text-base font-semibold">{t("summary")}</h2>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className={wrapBadgeClass}>{professional
                  ? t("professionalCounts", {
                    core: formatNumber(locale, categories.nonBrandCore),
                    comparison: formatNumber(locale, categories.comparison),
                    brandFact: formatNumber(locale, categories.brandFact),
                    exploration: formatNumber(locale, categories.exploration),
                    primary: formatNumber(locale, categories.primary),
                  })
                  : t("counts", { saved: formatNumber(locale, view.preview.saved), primary: formatNumber(locale, view.preview.primary) })}</Badge>
              </div>
            </div>
            <p className="text-sm leading-6 [overflow-wrap:anywhere]">
              {t("budget", {
                count: formatNumber(locale, data.budget.questionCount),
                primary: formatNumber(locale, data.budget.primaryCount),
                region: data.budget.region,
                language: data.budget.language,
              })}
            </p>
            <p className="text-sm leading-6 text-muted-foreground">{t("repeatsOpen")}</p>
            <p className="text-sm leading-6 text-muted-foreground">{t("briefLater")}</p>
            {view.warnings.map((warning) => (
              <p key={warning.code + warning.questionIds.join()} className="rounded-lg border border-amber-500/30 bg-muted/40 px-3 py-2 text-sm leading-6 [overflow-wrap:anywhere]">
                {t(warning.code)}
              </p>
            ))}
            {data.gaps.length > 0 && <p className="text-sm leading-6 text-muted-foreground">{t("briefGaps")}</p>}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="prompt-professional">
        <Card className="min-w-0 py-0 shadow-none">
          <CardContent className="space-y-4 p-4 sm:p-5">
            <h2 id="prompt-professional" className="text-base font-semibold">{t("professionalTitle")}</h2>
            <p className="text-sm leading-6 text-muted-foreground">{t("professionalIntro")}</p>
            <p className="text-sm leading-6">{professional ? t("professionalDraftLabel") : t("professionalTemplateLabel")}</p>
            <p className="text-sm leading-6 tabular-nums">{t("professionalCounts", {
              core: formatNumber(locale, categories.nonBrandCore),
              comparison: formatNumber(locale, categories.comparison),
              brandFact: formatNumber(locale, categories.brandFact),
              exploration: formatNumber(locale, categories.exploration),
              primary: formatNumber(locale, categories.primary),
            })}</p>
            <Button
              type="button"
              className={actionClass}
              disabled={data.readOnly}
              aria-disabled={pending}
              onClick={() => {
                if (pending) return;
                loadProfessional();
              }}
            >
              {t("loadProfessional")}
            </Button>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="prompt-candidates">
        <Card className="min-w-0 py-0 shadow-none">
          <CardContent className="space-y-4 p-4 sm:p-5">
            <h2 id="prompt-candidates" className="text-base font-semibold">{t("candidates")}</h2>
            <p className="text-sm leading-6 text-muted-foreground">{t("sourceTemplate")}</p>
            <ul className="space-y-3">
              {data.candidates.map((candidate) => (
                <li className="flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-lg border bg-background p-3" key={candidate.key}>
                  <p className="min-w-0 flex-1 text-sm leading-6 [overflow-wrap:anywhere]">{candidate.text}</p>
                  <Button
                    type="button"
                    variant="outline"
                    className={actionClass}
                    disabled={data.readOnly}
                    aria-disabled={pending}
                    onClick={() => addQuestion({
                      text: candidate.text, source: candidate.source, sourceNote: candidate.sourceNote,
                      type: candidate.type, stage: candidate.stage, status: "candidate",
                    })}
                  >
                    {t("addCandidate")}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="prompt-suggestions">
        <Card className="min-w-0 py-0 shadow-none">
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="prompt-suggestions" className="text-base font-semibold">{t("generateSuggestions")}</h2>
              <Button
                type="button"
                variant="outline"
                className={actionClass}
                disabled={data.readOnly}
                aria-disabled={pending}
                onClick={() => postSuggestion({
                  action: "generate", promptSetId: data.selected?.id ?? data.draft?.baseSetId ?? null,
                })}
              >
                {pending && pendingAction === "generate" ? t("generatingSuggestions") : t("generateSuggestions")}
              </Button>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">{t("suggestionIntro")}</p>
            {suggestions.length === 0 ? (
              <p className={emptySurfaceClass}>{t("suggestionEmpty")}</p>
            ) : (
              <ul className="space-y-3">
                {suggestions.map((suggestion) => (
                  <li className="space-y-2 rounded-lg border bg-background p-3" key={suggestion.id}>
                    <p className="min-w-0 text-sm leading-6 [overflow-wrap:anywhere]">{suggestion.candidate.text}</p>
                    {suggestion.candidate.warnings.includes("similar") && (
                      <p className="text-sm leading-6 text-muted-foreground">{t("suggestionSimilar")}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        className={actionClass}
                        disabled={data.readOnly}
                        aria-disabled={pending}
                        onClick={() => postSuggestion({ action: "accept", id: suggestion.id })}
                      >
                        {t("acceptSuggestion")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className={actionClass}
                        disabled={data.readOnly}
                        aria-disabled={pending}
                        onClick={() => postSuggestion({ action: "dismiss", id: suggestion.id })}
                      >
                        {t("dismissSuggestion")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {data.onboarding.length > 0 && (
        <section aria-labelledby="prompt-onboarding">
          <Card className="min-w-0 py-0 shadow-none">
            <CardContent className="space-y-4 p-4 sm:p-5">
              <h2 id="prompt-onboarding" className="text-base font-semibold">{t("onboarding")}</h2>
              <ul className="space-y-3">
                {data.onboarding.map((text) => (
                  <li className="flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-lg border bg-background p-3" key={text}>
                    <p className="min-w-0 flex-1 text-sm leading-6 [overflow-wrap:anywhere]">{text}</p>
                    {Array.from(text).length < 5 ? <p className="text-sm text-muted-foreground">{t("tooShort")}</p> : (
                      <Button
                        type="button"
                        variant="outline"
                        className={actionClass}
                        disabled={data.readOnly}
                        aria-disabled={pending}
                        onClick={() => addQuestion({
                          text, source: "manual", sourceNote: "onboarding-draft", type: "discovery", stage: "consider", status: "candidate",
                        })}
                      >
                        {t("importOnboarding")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}

      <section>
        <Card className="min-w-0 py-0 shadow-none">
          <CardContent className="space-y-4 p-4 sm:p-5">
            <Field label={t("pasteLines")}>
              <textarea className={controlClass} rows={4} value={paste} readOnly={data.readOnly} onChange={(event) => setPaste(event.target.value)} />
            </Field>
            <Button
              type="button"
              variant="outline"
              className={actionClass}
              disabled={data.readOnly}
              aria-disabled={pending}
              onClick={() => {
                if (pending) return;
                const lines = paste.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
                setContent((current) => {
                  const clusters = current.clusters.length ? current.clusters : [emptyCluster()];
                  const room = activeQuestionLimit(current.questions) - current.questions.filter((question) => question.status !== "inactive").length;
                  const additions = lines.slice(0, Math.max(room, 0)).map((text) => ({
                    id: crypto.randomUUID(), clusterId: clusters[0].id, text, source: "paste" as const, sourceNote: "line-paste",
                    type: "discovery" as const, stage: "consider" as const, region: data.brand.region, language: data.brand.language,
                    status: "candidate" as const, acceptSimilar: false, primary: false,
                  }));
                  return { clusters, questions: [...current.questions, ...additions] };
                });
                if (lines.length > questionLimit - activeCount) trimNotice();
                setPaste("");
              }}
            >
              {t("addPaste")}
            </Button>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="prompt-clusters">
        <Card className="min-w-0 py-0 shadow-none">
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="prompt-clusters" className="text-base font-semibold">{t("cluster")}</h2>
              <Button
                type="button"
                variant="outline"
                className={actionClass}
                disabled={data.readOnly || content.clusters.length >= 10}
                aria-disabled={pending}
                onClick={() => {
                  if (pending) return;
                  setContent((current) => ({ ...current, clusters: [...current.clusters, emptyCluster()] }));
                }}
              >
                {t("addCluster")}
              </Button>
            </div>
            {content.clusters.map((cluster, index) => (
              <div className="grid gap-3 border-t pt-3 sm:grid-cols-2" key={cluster.id}>
                <Field label={t("audienceLabel", { index: formatNumber(locale, index + 1) })}>
                  <Input className={inputClass} value={cluster.audience} readOnly={data.readOnly} onChange={(event) => setContent((current) => ({
                    ...current, clusters: current.clusters.map((item) => item.id === cluster.id ? { ...item, audience: event.target.value } : item),
                  }))} />
                </Field>
                <Field label={t("intentLabel", { index: formatNumber(locale, index + 1) })}>
                  <Input className={inputClass} value={cluster.intent} readOnly={data.readOnly} onChange={(event) => setContent((current) => ({
                    ...current, clusters: current.clusters.map((item) => item.id === cluster.id ? { ...item, intent: event.target.value } : item),
                  }))} />
                </Field>
                <Field label={t("primaryPage")}>
                  <Input className={inputClass} value={cluster.primaryPage} readOnly={data.readOnly} onChange={(event) => setContent((current) => ({
                    ...current, clusters: current.clusters.map((item) => item.id === cluster.id ? { ...item, primaryPage: event.target.value } : item),
                  }))} />
                </Field>
                <Field label={t("conversionAction")}>
                  <Input className={inputClass} value={cluster.conversionAction} readOnly={data.readOnly} onChange={(event) => setContent((current) => ({
                    ...current, clusters: current.clusters.map((item) => item.id === cluster.id ? { ...item, conversionAction: event.target.value } : item),
                  }))} />
                </Field>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="prompt-questions">
        <Card className="min-w-0 py-0 shadow-none">
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="prompt-questions" className="text-base font-semibold">{t("questions")}</h2>
              <Button
                type="button"
                variant="outline"
                className={actionClass}
                disabled={data.readOnly}
                aria-disabled={pending}
                onClick={() => addQuestion({
                  text: data.brand.language.toLowerCase().startsWith("zh") ? "请补充一个购买问题" : "Replace this buying question",
                  source: "manual", sourceNote: "", type: "discovery", stage: "consider", status: "candidate",
                })}
              >
                {t("addQuestion")}
              </Button>
            </div>
            {content.questions.length === 0 ? (
              <p className={emptySurfaceClass}>{t("empty")}</p>
            ) : (
              <div className="space-y-5">
                {content.questions.map((question, index) => {
                  const number = formatNumber(locale, index + 1);
                  const effective = view.questions.find((item) => item.id === question.id);
                  return (
                    <fieldset className="w-full min-w-0 space-y-3 rounded-xl border bg-background p-4" key={question.id} disabled={data.readOnly}>
                      <legend className="px-1 text-sm font-medium">{t("textLabel", { index: number })}</legend>
                      <textarea aria-label={t("textLabel", { index: number })} className={controlClass} rows={3} value={question.text}
                        onChange={(event) => updateQuestion(question.id, { text: event.target.value })} />
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs text-muted-foreground">{t("length", { count: formatNumber(locale, Array.from(question.text).length) })}</p>
                        <Badge variant="outline" className={wrapBadgeClass}>{t(question.status)}</Badge>
                        {effective && !effective.primary && question.status !== "inactive" && (
                          <Badge variant="secondary" className={wrapBadgeClass}>{t("primaryExcluded")}</Badge>
                        )}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={t("type")}><select className={controlClass} value={question.type} onChange={(event) => updateQuestion(question.id, { type: event.target.value as PromptQuestion["type"] })}>
                          {questionType.options.map((option) => <option key={option} value={option}>{t(option)}</option>)}
                        </select></Field>
                        <Field label={t("stage")}><select className={controlClass} value={question.stage} onChange={(event) => updateQuestion(question.id, { stage: event.target.value as PromptQuestion["stage"] })}>
                          {buyingStage.options.map((option) => <option key={option} value={option}>{t(option)}</option>)}
                        </select></Field>
                        <Field label={t("source")}><select className={controlClass} value={question.source} onChange={(event) => updateQuestion(question.id, { source: event.target.value as PromptQuestion["source"] })}>
                          {questionSource.options.map((option) => <option key={option} value={option}>{t(option)}</option>)}
                        </select></Field>
                        <Field label={t("statusLabel", { index: number })}><select aria-label={t("statusLabel", { index: number })} className={controlClass} value={question.status} onChange={(event) => updateQuestion(question.id, { status: event.target.value as PromptQuestion["status"] })}>
                          {questionStatus.options.map((option) => <option key={option} value={option}>{t(option)}</option>)}
                        </select></Field>
                        <Field label={t("region")}><Input className={inputClass} value={question.region} onChange={(event) => updateQuestion(question.id, { region: event.target.value })} /></Field>
                        <Field label={t("language")}><Input className={inputClass} value={question.language} onChange={(event) => updateQuestion(question.id, { language: event.target.value })} /></Field>
                        <Field label={t("sourceNote")}><Input className={inputClass} value={question.sourceNote} onChange={(event) => updateQuestion(question.id, { sourceNote: event.target.value })} /></Field>
                        <Field label={t("cluster")}><select className={controlClass} value={question.clusterId} onChange={(event) => updateQuestion(question.id, { clusterId: event.target.value })}>
                          {content.clusters.map((cluster, clusterIndex) => <option key={cluster.id} value={cluster.id}>{t("audienceLabel", { index: formatNumber(locale, clusterIndex + 1) })}</option>)}
                        </select></Field>
                      </div>
                      <label className="flex items-start gap-2 text-sm leading-6">
                        <input type="checkbox" className={checkboxClass} checked={question.acceptSimilar} onChange={(event) => updateQuestion(question.id, { acceptSimilar: event.target.checked })} />
                        <span>{t("acceptSimilar")}</span>
                      </label>
                      <Button
                        type="button"
                        variant="outline"
                        className={actionClass}
                        aria-disabled={pending}
                        onClick={() => {
                          if (pending) return;
                          setContent((current) => ({
                            ...current,
                            questions: data.referenced.includes(question.id)
                              ? current.questions.map((item) => item.id === question.id ? { ...item, status: "inactive" } : item)
                              : current.questions.filter((item) => item.id !== question.id),
                          }));
                        }}
                      >
                        {data.referenced.includes(question.id) ? t("deactivate") : t("remove")}
                      </Button>
                    </fieldset>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" value="save" className={actionClass} disabled={data.readOnly} aria-disabled={pending}>
          {pending && pendingAction === "saveDraft" ? t("saving") : t("save")}
        </Button>
        <Button type="submit" value="freeze" variant="outline" className={actionClass} disabled={data.readOnly} aria-disabled={pending}>
          {pending && pendingAction === "freeze" ? t("saving") : t("freeze")}
        </Button>
      </div>

      <section aria-labelledby="prompt-versions">
        <Card className="min-w-0 py-0 shadow-none">
          <CardContent className="space-y-4 p-4 sm:p-5">
            <h2 id="prompt-versions" className="text-base font-semibold">{t("frozen")}</h2>
            {data.versions.items.length === 0 ? (
              <p className={emptySurfaceClass}>{t("noVersions")}</p>
            ) : (
              <ul className="space-y-2">
                {data.versions.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:border-primary aria-[current=page]:bg-accent/40"
                      aria-current={item.id === data.selected?.id ? "page" : undefined}
                      href={`${href}?version=${item.id}`}
                      prefetch={false}
                    >
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{t("version", { version: formatNumber(locale, item.version) })}</span>
                      <Badge variant="secondary" className={wrapBadgeClass}>
                        {t("counts", { saved: formatNumber(locale, item.saved), primary: formatNumber(locale, item.primary) })}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {data.versions.next && (
              <Link className="inline-block text-sm underline underline-offset-4 outline-none focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50" href={`${href}?after=${cursorValue(data.versions.next)}`} prefetch={false}>
                {t("earlier")}
              </Link>
            )}
            {data.selected && (
              <div className="space-y-3 border-t pt-3">
                <Badge variant="secondary">{t("version", { version: formatNumber(locale, data.selected.version) })}</Badge>
                <p className="text-sm leading-6 [overflow-wrap:anywhere]">
                  {t("budget", {
                    count: formatNumber(locale, data.selected.budget.questionCount),
                    primary: formatNumber(locale, data.selected.budget.primaryCount),
                    region: data.selected.budget.region,
                    language: data.selected.budget.language,
                  })}
                </p>
                <h3 className="font-medium">{t("exclusion")}</h3>
                {data.selected.exclusion.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noExclusion")}</p>
                ) : (
                  <ul className="list-inside list-disc space-y-1 text-sm leading-6 [overflow-wrap:anywhere]">
                    {data.selected.exclusion.map((id) => {
                      const question = data.selected?.content.questions.find((item) => item.id === id) ?? content.questions.find((item) => item.id === id);
                      return <li key={id}>{question?.text ?? id}</li>;
                    })}
                  </ul>
                )}
                <ul className="space-y-2 text-sm leading-6 [overflow-wrap:anywhere]">
                  {data.selected.content.questions.map((question) => (
                    <li key={question.id} className="rounded-lg border bg-background px-3 py-2">{question.text}</li>
                  ))}
                </ul>
              </div>
            )}
            {data.exclusion.length > 0 && !data.selected && (
              <div className="space-y-2 border-t pt-3">
                <h3 className="font-medium">{t("exclusion")}</h3>
                <ul className="list-inside list-disc space-y-1 text-sm leading-6 [overflow-wrap:anywhere]">
                  {data.exclusion.map((id) => <li key={id}>{content.questions.find((question) => question.id === id)?.text ?? id}</li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </form>
  );
}

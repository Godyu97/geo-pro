"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import type { LeadSuggestionError, LeadSuggestionStatus } from "./suggestion-contracts";

type Copy = Messages["leadSuggestions"];
type Decision = "accept" | "discard";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as { error?: { code?: LeadSuggestionError } };
  return { ok: response.ok, code: payload.error?.code };
}

export function DraftLeadSuggestionsForm({
  locale,
  messages,
  brandId,
  summaryId,
}: {
  locale: Locale;
  messages: Copy;
  brandId: string;
  summaryId: string;
}) {
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<LeadSuggestionError | "drafted" | null>(null);

  async function submit(form: FormData) {
    if (pending) return;
    setPending(true);
    setFeedback(null);
    try {
      const result = await postJson("/api/reports/lead-suggestions", {
        brandId,
        summary: String(form.get("summary") ?? ""),
      });
      if (!result.ok) {
        setFeedback(result.code && Object.hasOwn(messages, result.code) ? result.code : "SERVICE_UNAVAILABLE");
        return;
      }
      setFeedback("drafted");
      router.refresh();
    } catch {
      setFeedback("SERVICE_UNAVAILABLE");
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-labelledby="lead-suggestion-form" className="grid min-w-0 gap-4 rounded-2xl border bg-card p-5" onSubmit={(event) => {
      event.preventDefault();
      void submit(new FormData(event.currentTarget));
    }}>
      <h2 id="lead-suggestion-form" className="text-lg font-semibold">{t("draftTitle")}</h2>
      <div className="space-y-2 text-sm">
        <label htmlFor={summaryId} className="block font-medium">{t("summary")}</label>
        <textarea
          id={summaryId}
          name="summary"
          required
          minLength={8}
          maxLength={2000}
          rows={5}
          aria-describedby={`${summaryId}-hint`}
          className="block w-full scroll-mt-8 rounded-lg border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
        <p id={`${summaryId}-hint`} className="text-muted-foreground">{t("summaryHint")}</p>
      </div>
      <div>
        <Button type="submit" aria-disabled={pending} className={actionClass}>
          {pending ? t("drafting") : t("draft")}
        </Button>
      </div>
      <div role="status" className={feedback === "drafted" ? "text-sm" : "sr-only"}>
        {feedback === "drafted" ? t(feedback) : null}
      </div>
      {feedback && feedback !== "drafted" ? <p role="alert" className="text-sm">{t(feedback)}</p> : null}
    </form>
  );
}

export function LeadSuggestionReview({
  locale,
  messages,
  suggestionId,
  status,
  canWrite,
  modelName,
  children,
}: {
  locale: Locale;
  messages: Copy;
  suggestionId: string;
  status: LeadSuggestionStatus;
  canWrite: boolean;
  modelName: string;
  children: ReactNode;
}) {
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = `lead-suggestion-${suggestionId}`;
  const [pending, setPending] = useState<Decision | null>(null);
  const [savedStatus, setSavedStatus] = useState<"accepted" | "discarded" | null>(null);
  const [error, setError] = useState<LeadSuggestionError | null>(null);
  const visibleStatus = savedStatus ?? status;
  const label = {
    draft: t("statusDraft"),
    accepted: t("statusAccepted"),
    discarded: t("statusDiscarded"),
  }[visibleStatus];

  async function decide(action: Decision, trigger: HTMLButtonElement) {
    if (!canWrite || pending || visibleStatus !== "draft") return;
    setPending(action);
    setError(null);
    try {
      const result = await postJson(`/api/reports/lead-suggestions/${suggestionId}`, { action });
      if (!result.ok) {
        setError(result.code && Object.hasOwn(messages, result.code) ? result.code : "SERVICE_UNAVAILABLE");
        return;
      }
      setSavedStatus(action === "accept" ? "accepted" : "discarded");
      if (document.activeElement === trigger) heading.current?.focus();
      router.refresh();
    } catch {
      setError("SERVICE_UNAVAILABLE");
    } finally {
      setPending(null);
    }
  }

  return (
    <article aria-labelledby={headingId} className="min-w-0 space-y-3 rounded-2xl border bg-card p-5 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3
          id={headingId}
          ref={heading}
          tabIndex={-1}
          className="scroll-mt-6 text-base font-semibold focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          {label}
        </h3>
        <p className="min-w-0 text-sm text-muted-foreground">{t("modelLine", { model: modelName })}</p>
      </div>
      {children}
      {canWrite && visibleStatus === "draft" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" aria-disabled={pending !== null} className={actionClass} onClick={(event) => void decide("accept", event.currentTarget)}>
            {pending === "accept" ? t("accepting") : t("accept")}
          </Button>
          <Button type="button" variant="outline" aria-disabled={pending !== null} className={actionClass} onClick={(event) => void decide("discard", event.currentTarget)}>
            {pending === "discard" ? t("discarding") : t("discard")}
          </Button>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm">{t(error)}</p> : null}
      <div role="status" className={savedStatus ? "text-sm" : "sr-only"}>{savedStatus ? t("saved") : null}</div>
    </article>
  );
}

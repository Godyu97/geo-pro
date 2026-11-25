"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Messages } from "@/lib/i18n/server";

type Tri = "true" | "false" | "unknown";
type Network = "on" | "off" | "unknown";
type CitationState = "complete" | "partial" | "unsupported" | "missing";

const missingKeys = {
  "answer-missing": "missingAnswer",
  "citation-fields-missing": "missingCitation",
  "locator-missing": "missingLocator",
  "collector-missing": "missingCollector",
} as const;

export type ManualEvidenceContext = {
  brandId: string;
  brandName: string;
  aliases: string[];
  officialWebsite: string | null;
  entityVersion: number;
  region: string;
  language: string;
  questions: Array<{ id: string; text: string }>;
};

export type ManualEvidenceInitial = {
  questionText: string;
  answerText: string;
  targetRegion: string;
  observedRegion: string;
  newSession: Tri;
  productMode: Tri;
  requestedNetworkMode: Network;
  citationSetState: CitationState;
  citationUrls: string;
  collectorId: string;
  locatorRef: string;
  missingReason: string | null;
};

const fieldClass = "h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm";
const missingCodes = (value: string | null | undefined) =>
  (value ?? "").split(",").map((item) => item.trim()).filter((item): item is keyof typeof missingKeys => item in missingKeys);

function citationPayload(value: string) {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 50) return { error: "count" as const, citations: [] };
  const citations = lines.map((rawUrl, index) => {
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    } catch {
      return null;
    }
    return {
      rawUrl,
      citationOrigin: "consumer_visible" as const,
      positionLabel: String(index + 1),
      ownership: "unknown" as const,
      pageStatus: "unknown" as const,
    };
  });
  if (citations.some((item) => item === null)) return { error: "url" as const, citations: [] };
  return { error: null, citations: citations.flatMap((item) => item ? [item] : []) };
}

export function ManualEvidenceForm({
  mode,
  context,
  observationId,
  initial,
  messages,
}: {
  mode: "create" | "complete";
  context: ManualEvidenceContext;
  observationId?: string;
  initial?: ManualEvidenceInitial;
  messages: Messages["evidence"];
}) {
  const router = useRouter();
  const composing = useRef(false);
  const [questionId, setQuestionId] = useState("");
  const [questionText, setQuestionText] = useState(initial?.questionText ?? "");
  const [answerText, setAnswerText] = useState(initial?.answerText ?? "");
  const [productMode, setProductMode] = useState<Tri>(initial?.productMode ?? "unknown");
  const [requestedNetworkMode, setNetwork] = useState<Network>(initial?.requestedNetworkMode ?? "unknown");
  const [targetRegion, setTargetRegion] = useState(initial?.targetRegion ?? context.region);
  const [observedRegion, setObservedRegion] = useState(initial?.observedRegion ?? "unknown");
  const [newSession, setNewSession] = useState<Tri>(initial?.newSession ?? "unknown");
  const [citationSetState, setCitationState] = useState<CitationState>(initial?.citationSetState ?? "missing");
  const [citationUrls, setCitationUrls] = useState(initial?.citationUrls ?? "");
  const [collectorId, setCollectorId] = useState(initial?.collectorId ?? "");
  const [locatorRef, setLocatorRef] = useState(initial?.locatorRef ?? "");
  const [contested, setContested] = useState(false);
  const [missing, setMissing] = useState<Array<keyof typeof missingKeys>>(missingCodes(initial?.missingReason));
  const [draftId, setDraftId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function triSelect(id: string, label: string, value: Tri, onChange: (next: Tri) => void) {
    return (
      <div className="min-w-0 space-y-1">
        <Label htmlFor={id}>{label}</Label>
        <select id={id} className={fieldClass} value={value} disabled={pending} onChange={(event) => onChange(event.target.value as Tri)}>
          <option value="unknown">{messages.unknown}</option>
          <option value="true">{messages.true}</option>
          <option value="false">{messages.false}</option>
        </select>
      </div>
    );
  }

  return (
    <form
      className="min-w-0 space-y-4 rounded-2xl border bg-card p-4 sm:p-5"
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onSubmit={(event) => {
        event.preventDefault();
        if (composing.current || pending) return;
        setError(null);
        const parsedCitations = citationPayload(citationUrls);
        if (parsedCitations.error) {
          setError(messages.manualInvalidUrl);
          return;
        }
        setPending(true);
        void (async () => {
          try {
            const response = await fetch("/api/monitoring/answers", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: mode === "complete" ? "complete-manual" : "submit-manual",
                ...(mode === "complete" ? { observationId } : {}),
                brandId: context.brandId,
                operationId: crypto.randomUUID(),
                questionText,
                answerText,
                region: targetRegion,
                language: context.language,
                requestedNetworkMode,
                targetRegion,
                observedRegion,
                newSession,
                productMode,
                entityVersion: context.entityVersion,
                citationSetState,
                citations: parsedCitations.citations,
                locatorRef: locatorRef.trim() || null,
                collectorId: collectorId.trim() || null,
                contested,
                brandName: context.brandName,
                aliases: context.aliases,
                officialWebsite: context.officialWebsite,
              }),
            });
            const body = await response.json().catch(() => null) as {
              error?: string | { message?: string };
              observation?: { id?: string; missingReason?: string | null };
            } | null;
            if (body?.error === "EVIDENCE_INCOMPLETE" && body.observation?.id) {
              setDraftId(body.observation.id);
              setSavedId(null);
              setMissing(missingCodes(body.observation.missingReason));
              return;
            }
            if (!response.ok) {
              const message = body && typeof body.error === "object" ? body.error.message : null;
              setError(message || messages.SERVICE_UNAVAILABLE);
              return;
            }
            const id = body?.observation?.id;
            if (!id) {
              setError(messages.SERVICE_UNAVAILABLE);
              return;
            }
            setMissing([]);
            setDraftId(null);
            setSavedId(id);
            if (mode === "complete") router.refresh();
          } catch {
            setError(messages.SERVICE_UNAVAILABLE);
          } finally {
            setPending(false);
          }
        })();
      }}
    >
      <div className="min-w-0 space-y-1">
        <h2 className="font-semibold">{mode === "complete" ? messages.completeDraft : messages.manualEntry}</h2>
        <p className="max-w-2xl text-sm leading-6 break-words text-muted-foreground">{messages.manualEntryHint}</p>
        <p className="text-sm break-words">{messages.manualTrack}</p>
      </div>
      {context.questions.length > 0 && (
        <div className="min-w-0 space-y-1">
          <Label htmlFor="manual-question-pick">{messages.manualQuestionPick}</Label>
          <select
            id="manual-question-pick"
            className={fieldClass}
            value={questionId}
            disabled={pending}
            onChange={(event) => {
              const next = event.target.value;
              setQuestionId(next);
              const found = context.questions.find((item) => item.id === next);
              if (found) setQuestionText(found.text);
            }}
          >
            <option value="">{messages.manualQuestionCustom}</option>
            {context.questions.map((item) => (
              <option key={item.id} value={item.id}>{item.text}</option>
            ))}
          </select>
        </div>
      )}
      <div className="min-w-0 space-y-1">
        <Label htmlFor="manual-question">{messages.manualQuestion}</Label>
        <textarea
          id="manual-question"
          className="min-h-20 w-full min-w-0 rounded-lg border bg-background px-3 py-2 text-sm"
          value={questionText}
          required
          maxLength={4000}
          disabled={pending}
          onChange={(event) => setQuestionText(event.target.value)}
        />
        <p id="manual-question-hint" className="text-sm leading-6 break-words text-muted-foreground">{messages.manualQuestionHint}</p>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {triSelect("manual-mode", messages.manualMode, productMode, setProductMode)}
        <div className="min-w-0 space-y-1">
          <Label htmlFor="manual-network">{messages.requestedNetwork}</Label>
          <select id="manual-network" className={fieldClass} value={requestedNetworkMode} disabled={pending} onChange={(event) => setNetwork(event.target.value as Network)}>
            <option value="unknown">{messages.manualNetworkUnknown}</option>
            <option value="on">{messages.manualNetworkOn}</option>
            <option value="off">{messages.manualNetworkOff}</option>
          </select>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="manual-target-region">{messages.targetRegion}</Label>
          <Input id="manual-target-region" value={targetRegion} required maxLength={2} autoComplete="off" disabled={pending} onChange={(event) => setTargetRegion(event.target.value)} />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="manual-observed-region">{messages.observedRegion}</Label>
          <Input id="manual-observed-region" value={observedRegion} required maxLength={7} autoComplete="off" aria-describedby="manual-observed-hint" disabled={pending} onChange={(event) => setObservedRegion(event.target.value)} />
          <p id="manual-observed-hint" className="text-sm leading-6 break-words text-muted-foreground">{messages.manualObservedHint}</p>
        </div>
        {triSelect("manual-new-session", messages.newSession, newSession, setNewSession)}
        <div className="min-w-0 space-y-1">
          <Label htmlFor="manual-citation-state">{messages.manualCitationState}</Label>
          <select id="manual-citation-state" className={fieldClass} value={citationSetState} disabled={pending} onChange={(event) => setCitationState(event.target.value as CitationState)}>
            <option value="missing">{messages.citationMissing}</option>
            <option value="complete">{messages.complete}</option>
            <option value="partial">{messages.citationPartial}</option>
            <option value="unsupported">{messages.citationUnsupported}</option>
          </select>
        </div>
      </div>
      <div className="min-w-0 space-y-1">
        <Label htmlFor="manual-answer">{messages.rawAnswer}</Label>
        <textarea
          id="manual-answer"
          className="min-h-28 w-full min-w-0 rounded-lg border bg-background px-3 py-2 text-sm"
          value={answerText}
          maxLength={8000}
          disabled={pending}
          onChange={(event) => setAnswerText(event.target.value)}
        />
      </div>
      <div className="min-w-0 space-y-1">
        <Label htmlFor="manual-citations">{messages.manualCitationUrls}</Label>
        <textarea
          id="manual-citations"
          className="min-h-24 w-full min-w-0 rounded-lg border bg-background px-3 py-2 text-sm"
          value={citationUrls}
          maxLength={4000}
          spellCheck={false}
          aria-describedby="manual-citation-hint"
          disabled={pending}
          onChange={(event) => setCitationUrls(event.target.value)}
        />
        <p id="manual-citation-hint" className="text-sm leading-6 break-words text-muted-foreground">{messages.manualCitationHint}</p>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="manual-collector">{messages.manualCollector}</Label>
          <Input id="manual-collector" value={collectorId} maxLength={128} autoComplete="off" disabled={pending} onChange={(event) => setCollectorId(event.target.value)} />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="manual-locator">{messages.manualLocator}</Label>
          <Input id="manual-locator" value={locatorRef} maxLength={500} autoComplete="off" spellCheck={false} disabled={pending} onChange={(event) => setLocatorRef(event.target.value)} />
        </div>
      </div>
      <label className="flex min-w-0 items-start gap-2 text-sm leading-6" htmlFor="manual-contested">
        <input
          id="manual-contested"
          type="checkbox"
          className="mt-1"
          checked={contested}
          disabled={pending}
          onChange={(event) => setContested(event.target.checked)}
        />
        <span className="min-w-0 break-words">{messages.manualContested}</span>
      </label>
      {missing.length > 0 && (
        <div role="status" className="min-w-0 space-y-1 text-sm">
          <p>{messages.manualDraftSaved}</p>
          <p className="font-medium">{messages.manualMissingTitle}</p>
          <ul className="list-disc pl-5">
            {missing.map((code) => <li key={code} className="break-words">{messages[missingKeys[code]]}</li>)}
          </ul>
        </div>
      )}
      {draftId && (
        <Button asChild variant="outline" className="h-auto max-w-full whitespace-normal text-left">
          <Link href={`/dashboard/monitoring/evidence/${draftId}`} prefetch={false}>{messages.continueDraft}</Link>
        </Button>
      )}
      {savedId && <p className="text-sm break-words">{messages.manualSaved}</p>}
      {error && <p role="alert" className="text-sm break-words text-destructive">{error}</p>}
      <Button type="submit" className="h-auto max-w-full whitespace-normal text-left" disabled={pending || questionText.trim().length === 0}>
        {pending ? messages.manualSubmitting : mode === "complete" ? messages.completeDraft : messages.manualSubmit}
      </Button>
    </form>
  );
}

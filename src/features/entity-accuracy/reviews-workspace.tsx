"use client";

import { useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginPath } from "@/lib/auth/return-to";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import type { EntityReviewBoard } from "./commands";
import type { BrandFactClaimView, ClaimJudgment } from "./claims";
import { claimExtractErrors, entityReviewErrors, type ClaimExtractError, type EntityReviewError } from "./contracts";

type Copy = Messages["entityReviews"];
type FactState = "active" | "expired" | "conflict";
type Notice = { kind: "status" | "alert"; text: string };

const controlClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const inputClass = "h-10 bg-background";
const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center aria-disabled:opacity-60";
const wrapBadgeClass = "h-auto max-w-full whitespace-normal rounded-xl px-3 py-1 text-left leading-5 [overflow-wrap:anywhere]";
const checkboxClass = "mt-0.5 size-4 shrink-0 rounded border border-input accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const emptySurfaceClass = "rounded-xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground";

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function isKnownError(code: string): code is EntityReviewError {
  return Object.hasOwn(entityReviewErrors, code);
}

function isKnownExtractError(code: string): code is ClaimExtractError {
  return Object.hasOwn(claimExtractErrors, code);
}

function judgmentLabel(messages: Copy, judgment: ClaimJudgment) {
  if (judgment === "consistent") return messages.judgmentConsistent;
  if (judgment === "conflict") return messages.judgmentConflict;
  if (judgment === "insufficient") return messages.judgmentInsufficient;
  return messages.judgmentNotApplicable;
}

function factStatusLabel(messages: Copy, status: BrandFactClaimView["factStatus"]) {
  if (status === "approved") return messages.factStatusApproved;
  if (status === "expired") return messages.factStatusExpired;
  if (status === "revoked") return messages.factStatusRevoked;
  return null;
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

export function ReviewsWorkspace({
  brandId,
  locale,
  initialBoard,
  initialClaims,
  messages,
  initialError,
}: {
  brandId: string;
  locale: Locale;
  initialBoard: EntityReviewBoard;
  initialClaims: BrandFactClaimView[];
  messages: Copy;
  initialError: EntityReviewError | null;
}) {
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const [board, setBoard] = useState<EntityReviewBoard>(initialBoard);
  const [claims, setClaims] = useState<BrandFactClaimView[]>(initialClaims);
  const [observationId, setObservationId] = useState("");
  const [analysisVersionId, setAnalysisVersionId] = useState("");
  const [population, setPopulation] = useState("");
  const [method, setMethod] = useState("");
  const [fact, setFact] = useState<FactState>("active");
  const [reviewed, setReviewed] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmLocked, setConfirmLocked] = useState(false);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(
    initialError ? { kind: "alert", text: t(initialError) } : null,
  );
  const [pending, startTransition] = useTransition();
  const inFlightRef = useRef(false);
  const extractRef = useRef(false);
  const idPrefix = useId();
  const currentPath = `/dashboard/brands/${brandId}/entity-reviews`;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setNotice(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/brands/${brandId}/entity-reviews`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            method: method.trim(),
            population: Number(population),
            marks: [{
              observationId: observationId.trim(),
              analysisVersionId: analysisVersionId.trim(),
              reviewed,
              confirmed: confirmLocked ? false : confirmed,
              fact,
            }],
          }),
        });
        const body = await response.json().catch(() => null) as
          | EntityReviewBoard
          | { error?: { code?: string } }
          | null;

        if (!response.ok) {
          const code = body && "error" in body ? body.error?.code : undefined;
          if (response.status === 401 || code === "SESSION_REQUIRED") {
            router.push(loginPath(currentPath, "session-required"));
            return;
          }
          setNotice({
            kind: "alert",
            text: typeof code === "string" && isKnownError(code) ? t(code) : t("SERVICE_UNAVAILABLE"),
          });
          return;
        }

        if (body && "label" in body) {
          setBoard(body);
        }
        setNotice({ kind: "status", text: t("saved") });
        router.refresh();
      } catch {
        setNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
      } finally {
        inFlightRef.current = false;
      }
    });
  }

  function prefill(claim: BrandFactClaimView) {
    if (!claim.analysisVersionId) return;
    setObservationId(claim.observationId);
    setAnalysisVersionId(claim.analysisVersionId);
    setFact(claim.reviewFact);
    setReviewed(true);
    setConfirmed(false);
    setConfirmLocked(!claim.confirmable);
    setNotice({ kind: "status", text: messages.prefilled });
    document.getElementById("entity-review-form")?.scrollIntoView({ block: "start" });
  }

  function extractClaim(claim: BrandFactClaimView) {
    if (extractRef.current) return;
    extractRef.current = true;
    setExtractingId(claim.observationId);
    setNotice(null);
    void (async () => {
      try {
        const response = await fetch(`/api/brands/${brandId}/entity-reviews/claims`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ observationId: claim.observationId }),
        });
        const body = await response.json().catch(() => null) as
          | { claim?: BrandFactClaimView }
          | { error?: { code?: string } }
          | null;
        if (!response.ok) {
          const code = body && "error" in body ? body.error?.code : undefined;
          if (response.status === 401 || code === "SESSION_REQUIRED") {
            router.push(loginPath(currentPath, "session-required"));
            return;
          }
          setNotice({
            kind: "alert",
            text: typeof code === "string" && isKnownExtractError(code) ? t(code) : t("SERVICE_UNAVAILABLE"),
          });
          return;
        }
        if (body && "claim" in body && body.claim) {
          const next = body.claim;
          setClaims((current) => current.map((item) => item.observationId === next.observationId ? next : item));
        }
        setNotice({ kind: "status", text: messages.extractReady });
      } catch {
        setNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
      } finally {
        extractRef.current = false;
        setExtractingId(null);
      }
    })();
  }

  return (
    <div className="min-w-0 space-y-6">
      <NoticeBanner notice={notice} />

      <section
        id="brand-fact-claims"
        tabIndex={-1}
        aria-labelledby="brand-fact-claims-heading"
        className="scroll-mt-24 space-y-4 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <div className="min-w-0 space-y-2">
          <h2 id="brand-fact-claims-heading" className="text-lg font-semibold tracking-tight">
            {messages.claimsTitle}
          </h2>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{messages.claimsDescription}</p>
        </div>
        {claims.length === 0 ? (
          <p className={emptySurfaceClass}>{messages.claimsEmpty}</p>
        ) : (
          <ul className="space-y-3">
            {claims.map((claim) => {
              const statusLabel = factStatusLabel(messages, claim.factStatus);
              return (
                <li key={claim.observationId}>
                  <Card className="min-w-0">
                    <CardHeader>
                      <CardTitle className="text-base [overflow-wrap:anywhere]">
                        {t("claimQuestion", { text: claim.questionText })}
                      </CardTitle>
                      <CardDescription className="[overflow-wrap:anywhere]">
                        {t("claimAnswer", { text: claim.answerExcerpt })}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm leading-6 [overflow-wrap:anywhere]">
                        {t("claimStatement", { text: claim.claim })}
                      </p>
                      <div className="flex min-w-0 flex-wrap gap-2">
                        <Badge variant={claim.judgment === "conflict" ? "destructive" : "secondary"} className={wrapBadgeClass}>
                          {judgmentLabel(messages, claim.judgment)}
                        </Badge>
                        {statusLabel ? <Badge variant="outline" className={wrapBadgeClass}>{statusLabel}</Badge> : null}
                        {claim.factTitle ? (
                          <Badge variant="outline" className={wrapBadgeClass}>
                            {t("claimFact", { title: claim.factTitle })}
                          </Badge>
                        ) : null}
                      </div>
                      {claim.confirmable ? null : (
                        <p className="text-sm leading-6 text-muted-foreground">{messages.confirmBlocked}</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {claim.analysisVersionId ? (
                          <Button type="button" variant="outline" className={actionClass} onClick={() => prefill(claim)}>
                            {messages.prefillReview}
                          </Button>
                        ) : (
                          <p className="text-sm leading-6 text-muted-foreground">{messages.prefillNeedsAnalysis}</p>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          className={actionClass}
                          aria-disabled={extractingId === claim.observationId}
                          onClick={() => extractClaim(claim)}
                        >
                          {extractingId === claim.observationId ? messages.extractingClaim : messages.extractClaim}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section
        id="entity-review-summary"
        tabIndex={-1}
        aria-labelledby="entity-review-summary-heading"
        className="scroll-mt-24 space-y-4 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <h2 id="entity-review-summary-heading" className="sr-only">
          {messages.viewSampleSummary}
        </h2>
        {board.label === "sample" && board.errorLabel && board.coverage ? (
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle className="[overflow-wrap:anywhere]">
                {t("sample", { errorLabel: board.errorLabel })}
              </CardTitle>
              <CardDescription className="[overflow-wrap:anywhere]">
                {t("coverage", { coverage: board.coverage })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex min-w-0 flex-wrap gap-2">
                <Badge variant="outline" className={wrapBadgeClass}>
                  {t("sample", { errorLabel: board.errorLabel })}
                </Badge>
                <Badge variant="secondary" className={wrapBadgeClass}>
                  {t("coverage", { coverage: board.coverage })}
                </Badge>
                {board.method ? (
                  <Badge variant="outline" className={wrapBadgeClass}>
                    {t("method", { method: board.method })}
                  </Badge>
                ) : null}
              </div>

              {board.reviews.length > 0 ? (
                <div className="space-y-3 border-t pt-4">
                  <h3 className="text-sm font-medium">{messages.reviewedListTitle}</h3>
                  <ul className="space-y-2">
                    {board.reviews.map((row) => (
                      <li key={row.id}>
                        <Card size="sm" className="min-w-0 bg-muted/30">
                          <CardContent className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 space-y-1 text-xs leading-5 text-muted-foreground">
                              <p className="[overflow-wrap:anywhere]">
                                {t("observationLabel", { id: row.observationId })}
                              </p>
                              <p className="[overflow-wrap:anywhere]">
                                {t("analysisLabel", { id: row.analysisVersionId })}
                              </p>
                            </div>
                            <Badge
                              variant={row.confirmed ? "destructive" : "secondary"}
                              className={wrapBadgeClass}
                            >
                              {row.confirmed ? messages.confirmedBadge : messages.reviewedClearBadge}
                            </Badge>
                          </CardContent>
                        </Card>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <p className={emptySurfaceClass}>{messages.insufficient}</p>
        )}
      </section>

      <section
        id="entity-review-form"
        tabIndex={-1}
        aria-labelledby="entity-review-form-heading"
        className="scroll-mt-24 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle id="entity-review-form-heading">{messages.formTitle}</CardTitle>
            <CardDescription className="max-w-3xl leading-6">{messages.hint}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid min-w-0 gap-4 sm:grid-cols-2">
              <Field label={messages.observationId} htmlFor={`${idPrefix}-observation`}>
                <Input
                  id={`${idPrefix}-observation`}
                  name="observationId"
                  required
                  value={observationId}
                  onChange={(event) => {
                    setObservationId(event.target.value);
                    setConfirmLocked(false);
                  }}
                  className={inputClass}
                />
              </Field>
              <Field label={messages.analysisVersionId} htmlFor={`${idPrefix}-analysis`}>
                <Input
                  id={`${idPrefix}-analysis`}
                  name="analysisVersionId"
                  required
                  value={analysisVersionId}
                  onChange={(event) => {
                    setAnalysisVersionId(event.target.value);
                    setConfirmLocked(false);
                  }}
                  className={inputClass}
                />
              </Field>
              <Field label={messages.population} htmlFor={`${idPrefix}-population`}>
                <Input
                  id={`${idPrefix}-population`}
                  name="population"
                  type="number"
                  min={1}
                  max={100000}
                  step={1}
                  required
                  value={population}
                  onChange={(event) => setPopulation(event.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label={messages.methodLabel} htmlFor={`${idPrefix}-method`}>
                <Input
                  id={`${idPrefix}-method`}
                  name="method"
                  required
                  maxLength={200}
                  value={method}
                  onChange={(event) => setMethod(event.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label={messages.fact} htmlFor={`${idPrefix}-fact`}>
                <select
                  id={`${idPrefix}-fact`}
                  name="fact"
                  value={fact}
                  onChange={(event) => setFact(event.target.value as FactState)}
                  className={controlClass}
                >
                  <option value="active">{messages.factActive}</option>
                  <option value="expired">{messages.factExpired}</option>
                  <option value="conflict">{messages.factConflict}</option>
                </select>
              </Field>
              <div className="flex flex-wrap items-end gap-4 pt-1 text-sm sm:col-span-2">
                <Label className="flex cursor-pointer items-center gap-2 font-normal">
                  <input
                    name="reviewed"
                    type="checkbox"
                    checked={reviewed}
                    onChange={(event) => setReviewed(event.target.checked)}
                    className={checkboxClass}
                  />
                  <span>{messages.reviewed}</span>
                </Label>
                <Label className="flex cursor-pointer items-center gap-2 font-normal">
                  <input
                    name="confirmed"
                    type="checkbox"
                    checked={confirmed}
                    disabled={confirmLocked}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    className={checkboxClass}
                  />
                  <span>{messages.confirmed}</span>
                </Label>
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" aria-disabled={pending} className={actionClass}>
                  {pending ? messages.saving : messages.submit}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

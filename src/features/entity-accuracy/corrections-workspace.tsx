"use client";

import { useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginPath } from "@/lib/auth/return-to";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { entityCorrectionErrors, type EntityCorrectionError } from "./contracts";
import type { EntityRevisionBoard } from "./revisions";

type Copy = Messages["entityCorrections"];
type Notice = { kind: "status" | "alert"; text: string };
type InitialError = "disambiguationInvalid" | "correctionInvalid" | "SERVICE_UNAVAILABLE" | null;

const inputClass = "h-10 bg-background";
const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center aria-disabled:opacity-60";
const wrapBadgeClass = "h-auto max-w-full whitespace-normal rounded-xl px-3 py-1 text-left leading-5 [overflow-wrap:anywhere]";
const checkboxClass = "mt-0.5 size-4 shrink-0 rounded border border-input accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const emptySurfaceClass = "rounded-xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground";

function Field({ label, htmlFor, className, children }: { label: string; htmlFor: string; className?: string; children: ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col gap-2 ${className ?? ""}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function isKnownError(code: string): code is EntityCorrectionError {
  return Object.hasOwn(entityCorrectionErrors, code);
}

function actionKey(action: EntityRevisionBoard["corrections"][number]["action"]) {
  if (action === "actioned") return "actionActioned" as const;
  return "actionOpen" as const;
}

function effectKey(effect: EntityRevisionBoard["corrections"][number]["effect"]) {
  if (effect === "unresolved") return "effectUnresolved" as const;
  if (effect === "pending_retest") return "effectPendingRetest" as const;
  return "effectOpen" as const;
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

export function CorrectionsWorkspace({
  brandId,
  locale,
  initialBoard,
  messages,
  initialError,
}: {
  brandId: string;
  locale: Locale;
  initialBoard: EntityRevisionBoard;
  messages: Copy;
  initialError: InitialError;
}) {
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const [board, setBoard] = useState<EntityRevisionBoard>(initialBoard);

  const [disambiguationObservationId, setDisambiguationObservationId] = useState("");
  const [priorAnalysisId, setPriorAnalysisId] = useState("");
  const [sameSurfaceName, setSameSurfaceName] = useState(false);
  const [confirmedDifferentEntity, setConfirmedDifferentEntity] = useState(false);
  const [disambiguationNotice, setDisambiguationNotice] = useState<Notice | null>(
    initialError === "disambiguationInvalid" || initialError === "SERVICE_UNAVAILABLE"
      ? { kind: "alert", text: t(initialError) }
      : null,
  );
  const [pendingDisambiguation, startDisambiguation] = useTransition();
  const disambiguationInFlightRef = useRef(false);

  const [correctionObservationId, setCorrectionObservationId] = useState("");
  const [actionDone, setActionDone] = useState(false);
  const [retestStillWrong, setRetestStillWrong] = useState(false);
  const [correctionNotice, setCorrectionNotice] = useState<Notice | null>(
    initialError === "correctionInvalid" ? { kind: "alert", text: t("correctionInvalid") } : null,
  );
  const [pendingCorrection, startCorrection] = useTransition();
  const correctionInFlightRef = useRef(false);
  const idPrefix = useId();

  const currentPath = `/dashboard/brands/${brandId}/entity-corrections`;

  function handleDisambiguationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disambiguationInFlightRef.current) return;
    disambiguationInFlightRef.current = true;
    setDisambiguationNotice(null);

    startDisambiguation(async () => {
      try {
        const response = await fetch(`/api/brands/${brandId}/entity-disambiguations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            observationId: disambiguationObservationId.trim(),
            priorAnalysisId: priorAnalysisId.trim(),
            sameSurfaceName,
            confirmedDifferentEntity,
          }),
        });
        const body = await response.json().catch(() => null) as
          | {
              id?: string;
              observationId?: string;
              priorAnalysisId?: string;
              nextAnalysisId?: string;
              countAsTargetMention?: boolean;
              error?: { code?: string };
            }
          | null;

        if (!response.ok) {
          const code = body?.error?.code;
          if (response.status === 401 || code === "SESSION_REQUIRED") {
            router.push(loginPath(currentPath, "session-required"));
            return;
          }
          const messageKey = code === "INVALID_INPUT"
            ? "disambiguationInvalid"
            : typeof code === "string" && isKnownError(code)
              ? code
              : "SERVICE_UNAVAILABLE";
          setDisambiguationNotice({ kind: "alert", text: t(messageKey) });
          return;
        }

        if (body?.id && body.observationId && body.priorAnalysisId && body.nextAnalysisId) {
          const savedRow = {
            id: body.id,
            observationId: body.observationId,
            priorAnalysisId: body.priorAnalysisId,
            nextAnalysisId: body.nextAnalysisId,
            countAsTargetMention: Boolean(body.countAsTargetMention),
          };
          setBoard((current) => ({
            ...current,
            disambiguations: [savedRow, ...current.disambiguations],
          }));
        }
        setDisambiguationNotice({ kind: "status", text: t("disambiguationSaved") });
        router.refresh();
      } catch {
        setDisambiguationNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
      } finally {
        disambiguationInFlightRef.current = false;
      }
    });
  }

  function handleCorrectionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (correctionInFlightRef.current) return;
    correctionInFlightRef.current = true;
    setCorrectionNotice(null);

    startCorrection(async () => {
      try {
        const response = await fetch(`/api/brands/${brandId}/entity-corrections`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            observationId: correctionObservationId.trim(),
            actionDone,
            retestStillWrong,
          }),
        });
        const body = await response.json().catch(() => null) as
          | {
              id?: string;
              observationId?: string;
              action?: EntityRevisionBoard["corrections"][number]["action"];
              effect?: EntityRevisionBoard["corrections"][number]["effect"];
              error?: { code?: string };
            }
          | null;

        if (!response.ok) {
          const code = body?.error?.code;
          if (response.status === 401 || code === "SESSION_REQUIRED") {
            router.push(loginPath(currentPath, "session-required"));
            return;
          }
          const messageKey = code === "INVALID_INPUT"
            ? "correctionInvalid"
            : typeof code === "string" && isKnownError(code)
              ? code
              : "SERVICE_UNAVAILABLE";
          setCorrectionNotice({ kind: "alert", text: t(messageKey) });
          return;
        }

        if (body?.id && body.observationId && body.action && body.effect) {
          const savedRow = {
            id: body.id,
            observationId: body.observationId,
            action: body.action,
            effect: body.effect,
          };
          setBoard((current) => ({
            ...current,
            corrections: [savedRow, ...current.corrections],
          }));
        }
        setCorrectionNotice({ kind: "status", text: t("correctionSaved") });
        router.refresh();
      } catch {
        setCorrectionNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
      } finally {
        correctionInFlightRef.current = false;
      }
    });
  }

  return (
    <div className="min-w-0 space-y-8">
      <section
        id="entity-disambiguation-section"
        tabIndex={-1}
        aria-labelledby="entity-disambiguation-heading"
        className="scroll-mt-24 space-y-4 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <h2 id="entity-disambiguation-heading" className="text-lg font-semibold">
          {messages.disambiguationTitle}
        </h2>

        {board.disambiguations.length > 0 ? (
          <ul className="space-y-3">
            {board.disambiguations.map((row) => (
              <li key={row.id}>
                <Card size="sm" className="min-w-0">
                  <CardContent className="space-y-2">
                    <p className="text-sm leading-6 [overflow-wrap:anywhere]">
                      {t("priorVersion", { id: row.priorAnalysisId })}
                    </p>
                    <p className="text-sm leading-6 [overflow-wrap:anywhere]">
                      {t("nextVersion", { id: row.nextAnalysisId })}
                    </p>
                    <Badge
                      variant={row.countAsTargetMention ? "outline" : "secondary"}
                      className={wrapBadgeClass}
                    >
                      {row.countAsTargetMention ? messages.mentionCounted : messages.mentionExcluded}
                    </Badge>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <p className={emptySurfaceClass}>{messages.emptyDisambiguation}</p>
        )}

        <NoticeBanner notice={disambiguationNotice} />

        <Card id="entity-disambiguation-form" tabIndex={-1} className="min-w-0 scroll-mt-24">
          <CardHeader>
            <CardDescription className="max-w-3xl leading-6">
              {messages.disambiguationHint}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleDisambiguationSubmit} className="grid min-w-0 gap-4 sm:grid-cols-2">
              <Field label={messages.observationId} htmlFor={`${idPrefix}-disambig-observation`}>
                <Input
                  id={`${idPrefix}-disambig-observation`}
                  name="observationId"
                  required
                  value={disambiguationObservationId}
                  onChange={(event) => setDisambiguationObservationId(event.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label={messages.priorAnalysisId} htmlFor={`${idPrefix}-disambig-prior`}>
                <Input
                  id={`${idPrefix}-disambig-prior`}
                  name="priorAnalysisId"
                  required
                  value={priorAnalysisId}
                  onChange={(event) => setPriorAnalysisId(event.target.value)}
                  className={inputClass}
                />
              </Field>
              <div className="flex flex-wrap items-end gap-4 pt-1 text-sm sm:col-span-2">
                <Label className="flex cursor-pointer items-center gap-2 font-normal">
                  <input
                    name="sameSurfaceName"
                    type="checkbox"
                    checked={sameSurfaceName}
                    onChange={(event) => setSameSurfaceName(event.target.checked)}
                    className={checkboxClass}
                  />
                  <span>{messages.sameSurfaceName}</span>
                </Label>
                <Label className="flex cursor-pointer items-center gap-2 font-normal">
                  <input
                    name="confirmedDifferentEntity"
                    type="checkbox"
                    checked={confirmedDifferentEntity}
                    onChange={(event) => setConfirmedDifferentEntity(event.target.checked)}
                    className={checkboxClass}
                  />
                  <span>{messages.confirmedDifferentEntity}</span>
                </Label>
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" aria-disabled={pendingDisambiguation} className={actionClass}>
                  {pendingDisambiguation ? messages.savingDisambiguation : messages.saveDisambiguation}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </section>

      <section
        id="entity-correction-section"
        tabIndex={-1}
        aria-labelledby="entity-correction-heading"
        className="scroll-mt-24 space-y-4 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <h2 id="entity-correction-heading" className="text-lg font-semibold">
          {messages.correctionTitle}
        </h2>

        {board.corrections.length > 0 ? (
          <ul className="space-y-3">
            {board.corrections.map((row) => (
              <li key={row.id}>
                <Card size="sm" className="min-w-0">
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      {row.observationId}
                    </p>
                    <dl className="grid gap-3 sm:grid-cols-2">
                      <div className="min-w-0 space-y-1">
                        <dt className="text-sm text-muted-foreground">{messages.actionHeading}</dt>
                        <dd>
                          <Badge
                            variant={row.action === "actioned" ? "default" : "secondary"}
                            className={wrapBadgeClass}
                          >
                            {t(actionKey(row.action))}
                          </Badge>
                        </dd>
                      </div>
                      <div className="min-w-0 space-y-1">
                        <dt className="text-sm text-muted-foreground">{messages.effectHeading}</dt>
                        <dd>
                          <Badge
                            variant={row.effect === "unresolved" ? "destructive" : "outline"}
                            className={wrapBadgeClass}
                          >
                            {t(effectKey(row.effect))}
                          </Badge>
                        </dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <p className={emptySurfaceClass}>{messages.emptyCorrection}</p>
        )}

        <NoticeBanner notice={correctionNotice} />

        <Card id="entity-correction-form" tabIndex={-1} className="min-w-0 scroll-mt-24">
          <CardHeader>
            <CardDescription className="max-w-3xl leading-6">
              {messages.correctionHint}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCorrectionSubmit} className="grid min-w-0 gap-4 sm:grid-cols-2">
              <Field label={messages.observationId} htmlFor={`${idPrefix}-correction-observation`} className="sm:col-span-2">
                <Input
                  id={`${idPrefix}-correction-observation`}
                  name="observationId"
                  required
                  value={correctionObservationId}
                  onChange={(event) => setCorrectionObservationId(event.target.value)}
                  className={inputClass}
                />
              </Field>
              <div className="flex flex-wrap items-end gap-4 pt-1 text-sm sm:col-span-2">
                <Label className="flex cursor-pointer items-center gap-2 font-normal">
                  <input
                    name="actionDone"
                    type="checkbox"
                    checked={actionDone}
                    onChange={(event) => setActionDone(event.target.checked)}
                    className={checkboxClass}
                  />
                  <span>{messages.actionDone}</span>
                </Label>
                <Label className="flex cursor-pointer items-center gap-2 font-normal">
                  <input
                    name="retestStillWrong"
                    type="checkbox"
                    checked={retestStillWrong}
                    onChange={(event) => setRetestStillWrong(event.target.checked)}
                    className={checkboxClass}
                  />
                  <span>{messages.retestStillWrong}</span>
                </Label>
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" aria-disabled={pendingCorrection} className={actionClass}>
                  {pendingCorrection ? messages.savingCorrection : messages.saveCorrection}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

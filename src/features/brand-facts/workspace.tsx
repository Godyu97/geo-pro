"use client";

import { useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginPath } from "@/lib/auth/return-to";
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { factCategory, pasteLimit, type FactCommand, type FactFields, type FactPaste } from "./contracts";
import { cursorValue } from "./params";
import { emptyFields, factGaps, factStatus, previewPaste, reviewDue } from "./rules";
import type { FactWorkspace } from "./service";

type Copy = Messages["brandFacts"];
type Translate = ReturnType<typeof createTranslator<Copy>>;
type PageLink = (change: Record<string, string | null>) => string;
type Submit = (command: FactCommand, change?: Record<string, string | null>) => void;
type EditorProps = {
  data: FactWorkspace;
  submit: Submit;
  pending: boolean;
  pendingAction: FactCommand["action"] | null;
  t: Translate;
  link: PageLink;
  locale: Locale;
};

const controlClass = "w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const inputClass = "h-10 bg-background";
const actionClass = "h-auto min-h-9 max-w-full whitespace-normal text-center aria-disabled:opacity-60";
const checkboxClass = "mt-0.5 size-4 shrink-0 rounded border border-input accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const contentStatusLabel = {
  draft: "draft",
  in_review: "contentInReview",
  approved: "approved",
  rejected: "contentRejected",
  invalidated: "contentInvalidated",
} as const;

function DependencyGroup({ title, empty, rows }: { title: string; empty: string; rows: ReactNode[] | null }) {
  return (
    <div className="space-y-1">
      <h4 className="font-medium">{title}</h4>
      {rows === null ? <p className="text-muted-foreground">{empty}</p> : <ul className="space-y-1">{rows}</ul>}
    </div>
  );
}

function useDraftId() {
  const previous = useRef<{ content: string; id: string } | null>(null);
  return (content: string) => {
    if (previous.current?.content !== content) previous.current = { content, id: crypto.randomUUID() };
    return previous.current.id;
  };
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return <Label className="flex min-w-0 flex-col items-stretch gap-2">{label}{children}</Label>;
}

function PasteEditor({ data, submit, pending, pendingAction, t, link, locale, seed }: EditorProps & { seed: (fields: FactFields) => void }) {
  const [original, setOriginal] = useState(data.paste?.original ?? "");
  const [preview, setPreview] = useState(!!data.paste);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const newId = useDraftId();
  const characterCount = Array.from(original).length;
  const saved = data.paste && data.paste.original === original;
  const canSplit = !!saved && !data.readOnly;
  const { segments, more } = preview ? previewPaste(original) : { segments: [], more: false };

  function buildCard(span: FactFields["pasteSpan"]) {
    if (!canSplit || (span && span[1] - span[0] > 4000)) return;
    const excerpt = span ? original.slice(...span) : "";
    seed({ ...emptyFields, pasteId: data.paste?.id ?? null, pasteSpan: span, claim: excerpt, sourceExcerpt: excerpt });
  }

  function manualCard() {
    const input = textarea.current;
    const span: [number, number] | null = input && input.selectionEnd > input.selectionStart &&
      original.slice(input.selectionStart, input.selectionEnd).trim() ? [input.selectionStart, input.selectionEnd] : null;
    buildCard(span && span[1] - span[0] <= 4000 ? span : null);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const previousId = data.paste?.id ?? null;
    const id = newId(JSON.stringify({ previousId, original }));
    submit({ action: "savePaste", id, previousId, original }, { paste: id, pasteAfter: null });
  }

  return (
    <section aria-labelledby="fact-source-heading">
      <Card className="min-w-0 py-0 shadow-none">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="fact-source-heading" className="text-base font-semibold">{t("pastes")}</h2>
            {data.paste && (
              <Link
                className="text-sm underline underline-offset-4 outline-none focus-visible:rounded-sm"
                href={link({ paste: null })}
                prefetch={false}
              >
                {t("newPaste")}
              </Link>
            )}
          </div>
          <form className="space-y-3" onSubmit={save}>
            <Labelled label={t("original")}>
              <textarea
                className={controlClass}
                rows={5}
                maxLength={pasteLimit * 2}
                value={original}
                ref={textarea}
                readOnly={data.readOnly || !!data.successor}
                onChange={(event) => { setOriginal(event.target.value); setPreview(false); }}
              />
            </Labelled>
            <p className="text-sm text-muted-foreground">{t("length", { count: formatNumber(locale, characterCount) })}</p>
            <div className="flex flex-wrap gap-2">
              {!data.readOnly && !data.successor && (
                <Button
                  type="submit"
                  className={actionClass}
                  aria-disabled={pending}
                  disabled={!original.trim() || characterCount > pasteLimit || !!saved}
                >
                  {pending && pendingAction === "savePaste" ? t("pendingSave") : t(data.paste ? "saveRevision" : "savePaste")}
                </Button>
              )}
              <Button type="button" variant="outline" className={actionClass} onClick={() => setPreview(true)}>{t("preview")}</Button>
              {canSplit && (
                <Button type="button" variant="outline" className={actionClass} onClick={manualCard}>{t("manual")}</Button>
              )}
            </div>
          </form>
          {!data.readOnly && (!saved || original.length > 4000) && (
            <p className="text-sm leading-6 text-muted-foreground">{t("saveBeforeSplit")}</p>
          )}
          {preview && (segments.length ? (
            <ul className="space-y-2">
              {segments.map(({ start, end, text }) => (
                <li key={start} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2">
                  <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm">
                    {text.slice(0, 4000)}{text.length > 4000 ? "…" : ""}
                  </span>
                  {canSplit && text.length <= 4000 && (
                    <Button type="button" variant="outline" size="sm" className={actionClass} onClick={() => buildCard([start, end])}>
                      {t("useCandidate")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : <p role="status" className="text-sm">{t("noLines")}</p>)}
          {more && <p className="text-sm text-muted-foreground">{t("previewLimit")}</p>}
          {data.paste?.previousId && (
            <Link className="block text-sm underline underline-offset-4" href={link({ paste: data.paste.previousId })} prefetch={false}>
              {t("previousRevision")}
            </Link>
          )}
          {data.successor && (
            <Link className="block text-sm underline underline-offset-4" href={link({ paste: data.successor })} prefetch={false}>
              {t("nextRevision")}
            </Link>
          )}
          {!!data.pastes.items.length && (
            <details>
              <summary className="cursor-pointer text-sm">{t("pastVersions")}</summary>
              <ul className="mt-2 space-y-2">
                {data.pastes.items.map((item) => (
                  <li key={item.id} className="text-sm [overflow-wrap:anywhere]">
                    <Link
                      className="underline underline-offset-4"
                      aria-current={item.id === data.paste?.id ? "page" : undefined}
                      href={link({ paste: item.id })}
                      prefetch={false}
                    >
                      {t("date", { time: formatDateTime(locale, new Date(item.createdAt)) })} · {item.id.slice(0, 8)}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {data.pastes.next && (
            <Link className="block text-sm underline underline-offset-4" href={link({ pasteAfter: cursorValue(data.pastes.next) })} prefetch={false}>
              {t("earlierPastes")}
            </Link>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function Fields({ value, set, disabled, linkedOriginal, t }: {
  value: FactFields; set: (fields: FactFields) => void; disabled: boolean; linkedOriginal: boolean; t: Translate;
}) {
  function select<K extends "category" | "sourceType" | "permission" | "validity">(key: K, options: readonly FactFields[K][]) {
    return (
      <select className={controlClass} value={value[key]} onChange={(event) => set({ ...value, [key]: event.target.value })}>
        {options.map((option) => <option key={option} value={option}>{t(option)}</option>)}
      </select>
    );
  }

  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-4 sm:grid-cols-2">
      <Labelled label={t("category")}>{select("category", factCategory.options)}</Labelled>
      <Labelled label={t("factTitle")}>
        <Input className={inputClass} value={value.title} maxLength={120} onChange={(e) => set({ ...value, title: e.target.value })} />
      </Labelled>
      <div className="sm:col-span-2">
        <Labelled label={t("claim")}>
          <textarea className={controlClass} rows={3} maxLength={4000} value={value.claim} onChange={(e) => set({ ...value, claim: e.target.value })} />
        </Labelled>
      </div>
      {!linkedOriginal && (
        <>
          <Labelled label={t("sourceType")}>{select("sourceType", ["url", "material", "internal"])}</Labelled>
          <Labelled label={t("sourceReference")}>
            <Input className={inputClass} value={value.sourceReference} maxLength={1000} onChange={(e) => set({ ...value, sourceReference: e.target.value })} />
          </Labelled>
        </>
      )}
      <Labelled label={t("sourceLocator")}>
        <Input className={inputClass} value={value.sourceLocator} maxLength={500} onChange={(e) => set({ ...value, sourceLocator: e.target.value })} />
      </Labelled>
      <Labelled label={t("sourceDate")}>
        <Input className={inputClass} type="date" value={value.sourceDate} onChange={(e) => set({ ...value, sourceDate: e.target.value })} />
      </Labelled>
      <div className="sm:col-span-2">
        <Labelled label={t(linkedOriginal ? "publicSourceExcerpt" : "sourceExcerpt")}>
          <textarea className={controlClass} rows={3} maxLength={4000} value={value.sourceExcerpt} onChange={(e) => set({ ...value, sourceExcerpt: e.target.value })} />
        </Labelled>
      </div>
      <div className="sm:col-span-2"><Labelled label={t("permission")}>{select("permission", ["unknown", "public", "private"])}</Labelled></div>
      <Labelled label={t("validity")}>{select("validity", ["unspecified", "dated", "longTerm"])}</Labelled>
      {value.validity === "dated" && (
        <Labelled label={t("validThrough")}>
          <Input className={inputClass} type="date" value={value.validThrough} onChange={(e) => set({ ...value, validThrough: e.target.value })} />
        </Labelled>
      )}
    </fieldset>
  );
}

function FactEditor({ data, submit, pending, pendingAction, t, link, locale, seed }: EditorProps & { seed: FactFields | null }) {
  const fact = seed ? null : data.fact;
  const source: FactPaste | null = data.paste;
  const [fields, setFields] = useState(seed ?? fact?.fields ?? emptyFields);
  const [revising, setRevising] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [retire, setRetire] = useState(false);
  const newId = useDraftId();
  const linkedOriginal = Boolean(fact?.originalFragment);
  const originalFragment = linkedOriginal ? data.originalFragment : null;
  const edit = fact && (fact.state === "draft" || fact.state === "pending_confirmation");
  const canEdit = !data.readOnly && (!fact || edit || revising);
  const dirty = !!fact && JSON.stringify(fact.fields) !== JSON.stringify(fields);
  const gaps = fact ? factGaps(fact.fields, data.today, linkedOriginal) : [];
  const time = (instant: string) => formatDateTime(locale, new Date(instant));
  const due = fact ? reviewDue(fact) : null;

  function save(event: FormEvent) {
    event.preventDefault();
    if (!canEdit || pending) return;
    if (fact && !revising) {
      submit({ action: "edit", id: fact.id, revision: fact.revision, fields });
    } else {
      const previousId = fact?.id ?? null;
      const id = newId(JSON.stringify({ previousId, fields }));
      submit({ action: "create", id, previousId, fields }, { fact: id, after: null, impactAfter: null });
    }
  }

  return (
    <section aria-labelledby="fact-editor-heading">
      <Card className="min-w-0 py-0 shadow-none">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="fact-editor-heading" tabIndex={-1} className="scroll-mt-24 text-base font-semibold focus-visible:outline-2 focus-visible:outline-ring">
              {t(revising ? "replace" : fact ? edit ? "editFact" : "reviewFact" : "form")}
            </h2>
            {fact && <Badge variant="outline">{t(factStatus(fact, data.today))}</Badge>}
          </div>
          {fact && (
            <div className="space-y-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
              <p>{t("entityVersion", { version: formatNumber(locale, fact.entityVersion) })}</p>
              {fact.confirmedAt && fact.confirmedBy && (
                <p>{t("approvalRecord", { time: time(fact.confirmedAt), actor: fact.confirmedBy })}</p>
              )}
              {fact.revokedAt && <p>{t("revocationRecord", { time: time(fact.revokedAt) })}</p>}
              {due && <p>{t(due.slice(0, 10) <= data.today ? "reviewOverdue" : "reviewDue", { time: time(due) })}</p>}
            </div>
          )}
          {fields.pasteId && (
            <div className="space-y-2 text-sm">
              <Link className="underline underline-offset-4" href={link({ paste: fields.pasteId })} prefetch={false}>
                {t("linkedSource")}
              </Link>
              {fields.pasteSpan && source?.id === fields.pasteId && (
                <blockquote
                  aria-label={t("sourceRange")}
                  className="border-s ps-3 whitespace-pre-wrap [overflow-wrap:anywhere] text-muted-foreground"
                >
                  {source.original.slice(...fields.pasteSpan)}
                </blockquote>
              )}
            </div>
          )}
          {linkedOriginal && (
            <section className="space-y-2 rounded-lg border bg-background p-3 text-sm" aria-labelledby="fact-original-heading">
              <h3 id="fact-original-heading" className="font-medium">{t("originalFragment")}</h3>
              {originalFragment ? (
                <>
                  <p className="[overflow-wrap:anywhere]">{originalFragment.fileName}</p>
                  <p>{originalFragment.page === null ? t("originalPageMissing") :
                    t("originalPage", { page: formatNumber(locale, originalFragment.page) })}</p>
                  <blockquote className="border-s ps-3 whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {originalFragment.excerpt}
                  </blockquote>
                  <p className="text-muted-foreground">{t("originalFragmentHint")}</p>
                </>
              ) : <p role="status">{t("originalFragmentUnavailable")}</p>}
            </section>
          )}

          <form className="space-y-4" onSubmit={save}>
            <Fields value={fields} set={setFields} disabled={!canEdit} linkedOriginal={linkedOriginal} t={t} />
            {canEdit && (
              <Button type="submit" className={actionClass} aria-disabled={pending} disabled={!!edit && !dirty}>
                {pending && (pendingAction === "create" || pendingAction === "edit")
                  ? t("pendingSave")
                  : t(edit ? "saveEdits" : "saveDraft")}
              </Button>
            )}
          </form>

          {fact && !revising && (
            <>
              {edit && gaps.length > 0 && (
                <div className="space-y-2 rounded-lg border bg-background p-3 text-sm">
                  <h3 className="font-medium">{t("gaps")}</h3>
                  <ul className="list-inside list-disc space-y-1">
                    {gaps.map((gap) => <li key={gap}>{t(gap)}</li>)}
                  </ul>
                </div>
              )}
              {data.conflict && data.dependencies && (
                <div className="space-y-3 rounded-lg border bg-background p-3 text-sm">
                  {fact.state === "pending_confirmation" && (
                    <>
                      <h3 className="font-medium">{t("priceConflict")}</h3>
                      <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{data.conflict.claim}</p>
                    </>
                  )}
                  <h3 className="font-medium">{t("replacementDependencies")}</h3>
                  <DependencyGroup
                    title={t("dependencyDrafts")}
                    empty={t("dependencyDraftsEmpty")}
                    rows={data.dependencies.drafts.length === 0 ? null : data.dependencies.drafts.map((draft) => (
                      <li key={draft.id} className="flex flex-wrap gap-x-3 gap-y-1 border-b pb-2">
                        <span className="[overflow-wrap:anywhere]">{draft.title}</span>
                        <span>{t(contentStatusLabel[draft.status])}</span>
                        <span className="[overflow-wrap:anywhere] font-mono text-xs">{draft.id}</span>
                      </li>
                    ))}
                  />
                  <DependencyGroup
                    title={t("dependencyVariants")}
                    empty={t("dependencyVariantsEmpty")}
                    rows={data.dependencies.variants.length === 0 ? null : data.dependencies.variants.map((variant) => (
                      <li key={variant.id} className="flex flex-wrap gap-x-3 gap-y-1 border-b pb-2">
                        <span>{variant.channel}</span>
                        <span className="[overflow-wrap:anywhere] font-mono text-xs">{variant.id}</span>
                      </li>
                    ))}
                  />
                  <DependencyGroup
                    title={t("dependencyPublications")}
                    empty={t("dependencyPublicationsEmpty")}
                    rows={data.dependencies.publications.length === 0 ? null : data.dependencies.publications.map((publication) => (
                      <li key={publication.id} className="flex flex-wrap gap-x-3 gap-y-1 border-b pb-2">
                        <span className="[overflow-wrap:anywhere]">{publication.pageUrl}</span>
                        <span className="[overflow-wrap:anywhere] font-mono text-xs">{publication.id}</span>
                      </li>
                    ))}
                  />
                  {data.dependencies.more && <p className="text-muted-foreground">{t("dependencyMore")}</p>}
                  <Link className="underline underline-offset-4" href={link({ fact: data.conflict.id, impactAfter: null })} prefetch={false}>
                    {t("previousApproval")}
                  </Link>
                </div>
              )}
              {!data.readOnly && (
                <div className="space-y-3">
                  {edit && dirty && <p className="text-sm leading-6 text-muted-foreground">{t("saveFirst")}</p>}
                  {fact.state === "draft" && (
                    <Button
                      type="button"
                      variant="outline"
                      className={actionClass}
                      aria-disabled={pending}
                      disabled={dirty}
                      onClick={() => {
                        if (!pending) submit({ action: "submit", id: fact.id, revision: fact.revision });
                      }}
                    >
                      {pending && pendingAction === "submit" ? t("pendingSave") : t("submit")}
                    </Button>
                  )}
                  {(fact.state === "pending_confirmation" || fact.state === "approved") && (
                    <Label className="flex cursor-pointer items-start gap-2.5 text-sm leading-snug">
                      <input
                        type="checkbox"
                        className={checkboxClass}
                        checked={confirmed}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                      <span>{t(fact.state === "approved" ? "acknowledgeRevoke" : "acknowledge")}</span>
                    </Label>
                  )}
                  {fact.state === "pending_confirmation" && data.conflict && (
                    <Label className="flex cursor-pointer items-start gap-2.5 text-sm leading-snug">
                      <input
                        type="checkbox"
                        className={checkboxClass}
                        checked={retire}
                        onChange={(event) => setRetire(event.target.checked)}
                      />
                      <span>{t("revokeConflict")}</span>
                    </Label>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {fact.state === "pending_confirmation" && (
                      <Button
                        type="button"
                        className={actionClass}
                        aria-disabled={pending}
                        disabled={dirty || !confirmed || gaps.length > 0 || (linkedOriginal && !originalFragment)}
                        onClick={() => {
                          if (!pending) {
                            submit({
                              action: "approve", id: fact.id, revision: fact.revision, confirmed: true,
                              conflictId: data.conflict?.id ?? null, revokeConflict: retire,
                            });
                          }
                        }}
                      >
                        {pending && pendingAction === "approve" ? t("pendingSave") : t("approve")}
                      </Button>
                    )}
                    {fact.state === "approved" && (
                      <Button
                        type="button"
                        variant="outline"
                        className={actionClass}
                        aria-disabled={pending}
                        disabled={!confirmed}
                        onClick={() => {
                          if (!pending) submit({ action: "revoke", id: fact.id, revision: fact.revision, confirmed: true });
                        }}
                      >
                        {pending && pendingAction === "revoke" ? t("pendingSave") : t("revoke")}
                      </Button>
                    )}
                    {!edit && data.latestId === fact.id && (
                      <Button type="button" variant="outline" className={actionClass} onClick={() => setRevising(true)}>
                        {t("replace")}
                      </Button>
                    )}
                  </div>
                </div>
              )}
              <div className="space-y-2 border-t pt-4 text-sm">
                <h3 className="font-medium">{t("impact")}</h3>
                {!data.impacts.length && <p className="text-muted-foreground">{t("impactEmpty")}</p>}
                <ul className="space-y-2">
                  {data.impacts.map(({ contentVersionId, stage, effect }) => (
                    <li key={contentVersionId} className="flex flex-wrap gap-x-3 gap-y-1 border-b pb-2">
                      <span className="[overflow-wrap:anywhere] font-mono text-xs">{contentVersionId}</span>
                      <span>{t(stage)}</span>
                      <span>{t(effect)}</span>
                    </li>
                  ))}
                </ul>
                {data.nextImpact && (
                  <Link className="underline underline-offset-4" href={link({ impactAfter: data.nextImpact })} prefetch={false}>
                    {t("earlierImpacts")}
                  </Link>
                )}
              </div>
            </>
          )}
          {revising && fact && (
            <Button
              type="button"
              variant="ghost"
              className={actionClass}
              onClick={() => { setFields(fact.fields); setRevising(false); }}
            >
              {t("cancelReplace")}
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export function FactWorkspaceView({ brandId, locale, data, messages }: { brandId: string; locale: Locale; data: FactWorkspace; messages: Copy }) {
  const router = useRouter();
  const query = useSearchParams();
  const [seed, setSeed] = useState<{ fields: FactFields; key: number } | null>(null);
  const [status, setStatus] = useState<keyof Copy | null>(null);
  const [pendingAction, setPendingAction] = useState<FactCommand["action"] | null>(null);
  const [pending, transition] = useTransition();
  const inFlightRef = useRef(false);
  const t = createTranslator(locale, messages);
  const base = `/dashboard/brands/${brandId}/facts`;

  function link(change: Record<string, string | null>) {
    const target = new URLSearchParams(query.toString());
    for (const [key, value] of Object.entries(change)) {
      if (value === null) target.delete(key);
      else target.set(key, value);
    }
    return target.size ? base + "?" + target.toString() : base;
  }

  function submit(command: FactCommand, change?: Record<string, string | null>) {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus(null);
    setPendingAction(command.action);
    transition(async () => {
      try {
        const response = await fetch(`/api/brands/${brandId}/facts`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command),
        });
        if (!response.ok) {
          const { error } = await response.json();
          setStatus(typeof error === "string" && Object.hasOwn(messages, error) ? error as keyof Copy : "unavailable");
          return;
        }
        setStatus("saved");
        setSeed(null);
        if (change) router.push(link(change), { scroll: false });
        else router.refresh();
      } catch {
        setStatus("unavailable");
      } finally {
        inFlightRef.current = false;
        setPendingAction(null);
      }
    });
  }

  const props = { data, submit, pending, pendingAction, t, link, locale };
  return (
    <div aria-busy={pending} className="space-y-4">
      {data.readOnly && (
        <p role="status" className="rounded-lg border bg-card p-3 text-sm leading-6">
          {t("readOnly")}
        </p>
      )}
      {status && (
        <div
          role={status === "saved" ? "status" : "alert"}
          className={status === "saved"
            ? "flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-sm leading-6"
            : "flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-card p-3 text-sm leading-6 text-destructive"}
        >
          <span>{t(status)}</span>
          {status === "signIn" && (
            <Link className="underline underline-offset-4" href={loginPath(link({}), "session-required")}>
              {t("signIn")}
            </Link>
          )}
          {(status === "conflict" || status === "unavailable") && (
            <Button type="button" size="sm" variant="outline" className={actionClass} onClick={() => router.refresh()}>
              {t("refresh")}
            </Button>
          )}
        </div>
      )}
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="min-w-0 space-y-4">
          <section aria-labelledby="fact-list-heading">
            <Card className="min-w-0 py-0 shadow-none">
              <CardContent className="space-y-4 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="fact-list-heading" className="text-base font-semibold">{t("facts")}</h2>
                  {(data.fact || seed) && !data.readOnly && (
                    <Link
                      className="text-sm underline underline-offset-4 outline-none focus-visible:rounded-sm"
                      href={link({ fact: null, impactAfter: null })}
                      onClick={() => setSeed(null)}
                      prefetch={false}
                    >
                      {t("newFact")}
                    </Link>
                  )}
                </div>
                {!data.versions.items.length && (
                  <p className="rounded-xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground">
                    {t("emptyFacts")}
                  </p>
                )}
                <ul className="space-y-2">
                  {data.versions.items.map((item) => (
                    <li key={item.id}>
                      <Link
                        className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:border-primary aria-[current=page]:bg-accent/40"
                        aria-current={item.id === data.fact?.id && !seed ? "page" : undefined}
                        href={link({ fact: item.id, impactAfter: null })}
                        prefetch={false}
                        onClick={() => setSeed(null)}
                      >
                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{item.title || t("untitled")}</span>
                        <span className="shrink-0">{t("version", { version: formatNumber(locale, item.version) })}</span>
                        <Badge variant="secondary" className="shrink-0">{t(item.status)}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
                {data.versions.next && (
                  <Link className="block text-sm underline underline-offset-4" href={link({ after: cursorValue(data.versions.next) })} prefetch={false}>
                    {t("earlierFacts")}
                  </Link>
                )}
              </CardContent>
            </Card>
          </section>
          <PasteEditor
            {...props}
            key={data.paste?.id ?? "new"}
            seed={(fields) => {
              setSeed((last) => ({ fields, key: (last?.key ?? 0) + 1 }));
              document.getElementById("fact-edit")?.focus();
            }}
          />
        </div>
        <div tabIndex={-1} id="fact-edit" className="min-w-0">
          <FactEditor
            {...props}
            key={seed ? `seed-${seed.key}` : `${data.fact?.id ?? "new"}-${data.fact?.revision ?? ""}`}
            seed={seed?.fields ?? null}
          />
        </div>
      </div>
    </div>
  );
}

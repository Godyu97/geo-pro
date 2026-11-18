"use client";

import { useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
type EditorProps = { data: FactWorkspace; submit: Submit; t: Translate; link: PageLink; locale: Locale };
const controlClass = "w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const panelClass = "min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-5";

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

function PasteEditor({ data, submit, t, link, locale, seed }: EditorProps & { seed: (fields: FactFields) => void }) {
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
    const previousId = data.paste?.id ?? null;
    const id = newId(JSON.stringify({ previousId, original }));
    submit({ action: "savePaste", id, previousId, original }, { paste: id, pasteAfter: null });
  }

  return (
    <section className={panelClass} aria-labelledby="fact-source-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="fact-source-heading" className="font-semibold">{t("pastes")}</h2>
        {data.paste && <Link className="text-sm underline" href={link({ paste: null })} prefetch={false}>{t("newPaste")}</Link>}
      </div>
      <form className="space-y-3" onSubmit={save}>
        <Labelled label={t("original")}>
          <textarea className={controlClass} rows={5} maxLength={pasteLimit * 2} value={original} ref={textarea}
            readOnly={data.readOnly || !!data.successor} onChange={(event) => { setOriginal(event.target.value); setPreview(false); }} />
        </Labelled>
        <p className="text-sm text-muted-foreground">{t("length", { count: formatNumber(locale, characterCount) })}</p>
        <div className="flex flex-wrap gap-2">
          {!data.readOnly && !data.successor && (
            <Button type="submit" disabled={!original.trim() || characterCount > pasteLimit || !!saved}>
              {t(data.paste ? "saveRevision" : "savePaste")}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setPreview(true)}>{t("preview")}</Button>
          {canSplit && <Button type="button" variant="outline" onClick={manualCard}>{t("manual")}</Button>}
        </div>
      </form>
      {!data.readOnly && (!saved || original.length > 4000) && <p className="text-sm text-muted-foreground">{t("saveBeforeSplit")}</p>}
      {preview && (segments.length ? (
        <ul className="space-y-2">
          {segments.map(({ start, end, text }) => (
            <li key={start} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
              <span className="min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere text-sm">{text.slice(0, 4000)}{text.length > 4000 ? "…" : ""}</span>
              {canSplit && text.length <= 4000 && <Button variant="outline" size="sm" onClick={() => buildCard([start, end])}>{t("useCandidate")}</Button>}
            </li>
          ))}
        </ul>
      ) : <p role="status" className="text-sm">{t("noLines")}</p>)}
      {more && <p className="text-sm text-muted-foreground">{t("previewLimit")}</p>}
      {data.paste?.previousId && <Link className="block text-sm underline" href={link({ paste: data.paste.previousId })} prefetch={false}>{t("previousRevision")}</Link>}
      {data.successor && <Link className="block text-sm underline" href={link({ paste: data.successor })} prefetch={false}>{t("nextRevision")}</Link>}
      {!!data.pastes.items.length && (
        <details>
          <summary className="cursor-pointer text-sm">{t("pastVersions")}</summary>
          <ul className="mt-2 space-y-2">
            {data.pastes.items.map((item) => <li key={item.id} className="text-sm">
              <Link className="underline" aria-current={item.id === data.paste?.id ? "page" : undefined} href={link({ paste: item.id })} prefetch={false}>
                {t("date", { time: formatDateTime(locale, new Date(item.createdAt)) })} · {item.id.slice(0, 8)}
              </Link>
            </li>)}
          </ul>
        </details>
      )}
      {data.pastes.next && <Link className="block text-sm underline" href={link({ pasteAfter: cursorValue(data.pastes.next) })} prefetch={false}>{t("earlierPastes")}</Link>}
    </section>
  );
}

function Fields({ value, set, disabled, t }: {
  value: FactFields; set: (fields: FactFields) => void; disabled: boolean; t: Translate;
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
      <Labelled label={t("factTitle")}><Input value={value.title} maxLength={120} onChange={(e) => set({ ...value, title: e.target.value })} /></Labelled>
      <div className="sm:col-span-2">
        <Labelled label={t("claim")}><textarea className={controlClass} rows={3} maxLength={4000} value={value.claim} onChange={(e) => set({ ...value, claim: e.target.value })} /></Labelled>
      </div>
      <Labelled label={t("sourceType")}>{select("sourceType", ["url", "material", "internal"])}</Labelled>
      <Labelled label={t("sourceReference")}><Input value={value.sourceReference} maxLength={1000} onChange={(e) => set({ ...value, sourceReference: e.target.value })} /></Labelled>
      <Labelled label={t("sourceLocator")}><Input value={value.sourceLocator} maxLength={500} onChange={(e) => set({ ...value, sourceLocator: e.target.value })} /></Labelled>
      <Labelled label={t("sourceDate")}><Input type="date" value={value.sourceDate} onChange={(e) => set({ ...value, sourceDate: e.target.value })} /></Labelled>
      <div className="sm:col-span-2">
        <Labelled label={t("sourceExcerpt")}><textarea className={controlClass} rows={3} maxLength={4000} value={value.sourceExcerpt} onChange={(e) => set({ ...value, sourceExcerpt: e.target.value })} /></Labelled>
      </div>
      <div className="sm:col-span-2"><Labelled label={t("permission")}>{select("permission", ["unknown", "public", "private"])}</Labelled></div>
      <Labelled label={t("validity")}>{select("validity", ["unspecified", "dated", "longTerm"])}</Labelled>
      {value.validity === "dated" && <Labelled label={t("validThrough")}><Input type="date" value={value.validThrough} onChange={(e) => set({ ...value, validThrough: e.target.value })} /></Labelled>}
    </fieldset>
  );
}

function FactEditor({ data, submit, t, link, locale, seed }: EditorProps & { seed: FactFields | null }) {
  const fact = seed ? null : data.fact;
  const source: FactPaste | null = data.paste;
  const [fields, setFields] = useState(seed ?? fact?.fields ?? emptyFields);
  const [revising, setRevising] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [retire, setRetire] = useState(false);
  const newId = useDraftId();
  const edit = fact && (fact.state === "draft" || fact.state === "pending_confirmation");
  const canEdit = !data.readOnly && (!fact || edit || revising);
  const dirty = !!fact && JSON.stringify(fact.fields) !== JSON.stringify(fields);
  const gaps = fact ? factGaps(fact.fields, data.today) : [];
  const time = (instant: string) => formatDateTime(locale, new Date(instant));
  const due = fact ? reviewDue(fact) : null;

  function save(event: FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    if (fact && !revising) {
      submit({ action: "edit", id: fact.id, revision: fact.revision, fields });
    } else {
      const previousId = fact?.id ?? null;
      const id = newId(JSON.stringify({ previousId, fields }));
      submit({ action: "create", id, previousId, fields }, { fact: id, after: null, impactAfter: null });
    }
  }

  return (
    <section className={panelClass} aria-labelledby="fact-editor-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="fact-editor-heading" className="font-semibold">{t(revising ? "replace" : fact ? edit ? "editFact" : "reviewFact" : "form")}</h2>
        {fact && <Badge variant="outline">{t(factStatus(fact, data.today))}</Badge>}
      </div>
      {fact && (
        <div className="space-y-1 text-sm text-muted-foreground wrap-anywhere">
          <p>{t("entityVersion", { version: formatNumber(locale, fact.entityVersion) })}</p>
          {fact.confirmedAt && fact.confirmedBy && <p>{t("approvalRecord", { time: time(fact.confirmedAt), actor: fact.confirmedBy })}</p>}
          {fact.revokedAt && <p>{t("revocationRecord", { time: time(fact.revokedAt) })}</p>}
          {due && <p>{t(due.slice(0, 10) <= data.today ? "reviewOverdue" : "reviewDue", { time: time(due) })}</p>}
        </div>
      )}
      {fields.pasteId && (
        <div className="space-y-2 text-sm">
          <Link className="underline" href={link({ paste: fields.pasteId })} prefetch={false}>{t("linkedSource")}</Link>
          {fields.pasteSpan && source?.id === fields.pasteId && (
            <blockquote aria-label={t("sourceRange")} className="border-s px-3 whitespace-pre-wrap wrap-anywhere text-muted-foreground">
              {source.original.slice(...fields.pasteSpan)}
            </blockquote>
          )}
        </div>
      )}

      <form className="space-y-4" onSubmit={save}>
        <Fields value={fields} set={setFields} disabled={!canEdit} t={t} />
        {canEdit && <Button type="submit" disabled={!!edit && !dirty}>{t(edit ? "saveEdits" : "saveDraft")}</Button>}
      </form>

      {fact && !revising && (
        <>
          {edit && gaps.length > 0 && (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <h3 className="font-medium">{t("gaps")}</h3>
              <ul className="list-inside list-disc">{gaps.map((gap) => <li key={gap}>{t(gap)}</li>)}</ul>
            </div>
          )}
          {fact.state === "pending_confirmation" && data.conflict && (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <h3 className="font-medium">{t("priceConflict")}</h3>
              <p className="whitespace-pre-wrap wrap-anywhere">{data.conflict.claim}</p>
              <Link className="underline" href={link({ fact: data.conflict.id, impactAfter: null })} prefetch={false}>{t("previousApproval")}</Link>
            </div>
          )}
          {!data.readOnly && (
            <div className="space-y-3">
              {edit && dirty && <p className="text-sm">{t("saveFirst")}</p>}
              {fact.state === "draft" && <Button variant="outline" disabled={dirty} onClick={() => submit({ action: "submit", id: fact.id, revision: fact.revision })}>{t("submit")}</Button>}
              {(fact.state === "pending_confirmation" || fact.state === "approved") && (
                <Label className="items-start leading-snug">
                  <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                  {t(fact.state === "approved" ? "acknowledgeRevoke" : "acknowledge")}
                </Label>
              )}
              {fact.state === "pending_confirmation" && data.conflict && (
                <Label className="items-start leading-snug">
                  <input type="checkbox" checked={retire} onChange={(event) => setRetire(event.target.checked)} />
                  {t("revokeConflict")}
                </Label>
              )}
              <div className="flex flex-wrap gap-2">
                {fact.state === "pending_confirmation" && (
                  <Button disabled={dirty || !confirmed || gaps.length > 0} onClick={() => submit({
                    action: "approve", id: fact.id, revision: fact.revision, confirmed: true,
                    conflictId: data.conflict?.id ?? null, revokeConflict: retire,
                  })}>{t("approve")}</Button>
                )}
                {fact.state === "approved" && (
                  <Button variant="outline" disabled={!confirmed} onClick={() => submit({ action: "revoke", id: fact.id, revision: fact.revision, confirmed: true })}>{t("revoke")}</Button>
                )}
                {!edit && data.latestId === fact.id && <Button variant="outline" onClick={() => setRevising(true)}>{t("replace")}</Button>}
              </div>
            </div>
          )}
          <div className="space-y-2 border-t pt-4 text-sm">
            <h3 className="font-medium">{t("impact")}</h3>
            {!data.impacts.length && <p className="text-muted-foreground">{t("impactEmpty")}</p>}
            <ul className="space-y-2">
              {data.impacts.map(({ contentVersionId, stage, effect }) => (
                <li key={contentVersionId} className="flex flex-wrap gap-x-3 gap-y-1 border-b pb-2">
                  <span className="wrap-anywhere font-mono text-xs">{contentVersionId}</span><span>{t(stage)}</span><span>{t(effect)}</span>
                </li>
              ))}
            </ul>
            {data.nextImpact && <Link className="underline" href={link({ impactAfter: data.nextImpact })} prefetch={false}>{t("earlierImpacts")}</Link>}
          </div>
        </>
      )}
      {revising && fact && <Button variant="ghost" onClick={() => { setFields(fact.fields); setRevising(false); }}>{t("cancelReplace")}</Button>}
    </section>
  );
}

export function FactWorkspaceView({ brandId, locale, data, messages }: { brandId: string; locale: Locale; data: FactWorkspace; messages: Copy }) {
  const router = useRouter();
  const query = useSearchParams();
  const [seed, setSeed] = useState<{ fields: FactFields; key: number } | null>(null);
  const [status, setStatus] = useState<keyof Copy | null>(null);
  const [pending, transition] = useTransition();
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
    setStatus(null);
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
      }
    });
  }

  const props = { data, submit, t, link, locale };
  return (
    <div aria-busy={pending} className="space-y-4">
      {data.readOnly && <p role="status">{t("readOnly")}</p>}
      {status && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm" role={status === "saved" ? "status" : "alert"}>
          <span>{t(status)}</span>
          {status === "signIn" && <Link className="underline" href={loginPath(link({}), "session-required")}>{t("signIn")}</Link>}
          {(status === "conflict" || status === "unavailable") && <Button size="sm" variant="outline" onClick={() => router.refresh()}>{t("refresh")}</Button>}
        </div>
      )}
      <fieldset disabled={pending} className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="min-w-0 space-y-4">
          <section className={panelClass} aria-labelledby="fact-list-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="fact-list-heading" className="font-semibold">{t("facts")}</h2>
              {(data.fact || seed) && !data.readOnly && (
                <Link className="text-sm underline" href={link({ fact: null, impactAfter: null })} onClick={() => setSeed(null)} prefetch={false}>{t("newFact")}</Link>
              )}
            </div>
            {!data.versions.items.length && <p className="text-sm text-muted-foreground">{t("emptyFacts")}</p>}
            <ul className="space-y-2">
              {data.versions.items.map((item) => (
                <li key={item.id}>
                  <Link className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted aria-[current=page]:border-primary"
                    aria-current={item.id === data.fact?.id && !seed ? "page" : undefined}
                    href={link({ fact: item.id, impactAfter: null })} prefetch={false} onClick={() => setSeed(null)}>
                    <span className="min-w-0 flex-1 wrap-anywhere">{item.title || t("untitled")}</span>
                    <span>{t("version", { version: formatNumber(locale, item.version) })}</span>
                    <Badge variant="secondary">{t(item.status)}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
            {data.versions.next && <Link className="block text-sm underline" href={link({ after: cursorValue(data.versions.next) })} prefetch={false}>{t("earlierFacts")}</Link>}
          </section>
          <PasteEditor {...props} key={data.paste?.id ?? "new"} seed={(fields) => {
            setSeed((last) => ({ fields, key: (last?.key ?? 0) + 1 }));
            document.getElementById("fact-edit")?.focus();
          }} />
        </div>
        <div tabIndex={-1} id="fact-edit" className="min-w-0">
          <FactEditor {...props} key={seed ? `seed-${seed.key}` : `${data.fact?.id ?? "new"}-${data.fact?.revision ?? ""}`} seed={seed?.fields ?? null} />
        </div>
      </fieldset>
    </div>
  );
}

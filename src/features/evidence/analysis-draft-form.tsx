"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";

type Tri = "true" | "false" | "unknown";

type OpenDraft = {
  id: string;
  mentioned: Tri;
  recommended: Tri;
  officialSiteCited: Tri;
  modelName: string;
  createdAt: string;
};

function triState(value: unknown): Tri | null {
  return value === "true" || value === "false" || value === "unknown" ? value : null;
}

function readDraft(value: unknown): OpenDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = Object.fromEntries(Object.entries(value));
  const mentioned = triState(draft.mentioned);
  const recommended = triState(draft.recommended);
  const officialSiteCited = triState(draft.officialSiteCited);
  if (typeof draft.id !== "string" || !mentioned || !recommended || !officialSiteCited) return null;
  if (typeof draft.modelName !== "string" || typeof draft.createdAt !== "string") return null;
  return { id: draft.id, mentioned, recommended, officialSiteCited, modelName: draft.modelName, createdAt: draft.createdAt };
}

function formatWhen(locale: Locale, value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function AnalysisDraftPanel({
  locale,
  observationId,
  expectedVersion,
  drafts,
  messages,
}: {
  locale: Locale;
  observationId: string;
  expectedVersion: number | null;
  drafts: OpenDraft[];
  messages: Messages["evidence"];
}) {
  const router = useRouter();
  const [openDrafts, setOpenDrafts] = useState(drafts);
  const [version, setVersion] = useState(expectedVersion);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function post(body: unknown, onOk: (payload: { draft?: { id: string }; latestAnalysis?: { version: number } }) => void) {
    setError(null);
    setNotice(null);
    start(async () => {
      const response = await fetch(`/api/monitoring/answers/${observationId}/analysis-drafts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error?.message ?? messages.SERVICE_UNAVAILABLE);
        return;
      }
      onOk(payload ?? {});
      router.refresh();
    });
  }

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">{messages.analysisDraft}</h2>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => post({ action: "generate" }, (payload) => {
            const draft = readDraft(payload.draft);
            if (!draft) return;
            setOpenDrafts((current) => [draft, ...current.filter((item) => item.id !== draft.id)].slice(0, 20));
            setNotice(messages.draftReady);
          })}
        >
          {pending ? messages.generatingDraft : messages.generateDraft}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{messages.analysisDraftHint}</p>
      {version === null && <p className="text-sm">{messages.draftNeedsAnalysis}</p>}
      {openDrafts.length === 0 && <p className="text-sm">{messages.draftEmpty}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-sm">{notice}</p>}
      <ul className="space-y-3">
        {openDrafts.map((draft) => (
          <li key={draft.id}>
            <DraftEditor
              locale={locale}
              draft={draft}
              pending={pending}
              canApply={version !== null}
              messages={messages}
              onApply={(values) => {
                if (version === null) return;
                post({
                  action: "apply",
                  draftId: draft.id,
                  expectedVersion: version,
                  operationId: crypto.randomUUID(),
                  ...values,
                }, (payload) => {
                setOpenDrafts((current) => current.filter((item) => item.id !== draft.id));
                if (payload.latestAnalysis) setVersion(payload.latestAnalysis.version);
                setNotice(messages.draftApplied);
              });
              }}
              onDismiss={() => post({ action: "dismiss", draftId: draft.id }, () => {
                setOpenDrafts((current) => current.filter((item) => item.id !== draft.id));
                setNotice(messages.draftDismissed);
              })}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function DraftEditor({
  locale,
  draft,
  pending,
  canApply,
  messages,
  onApply,
  onDismiss,
}: {
  locale: Locale;
  draft: OpenDraft;
  pending: boolean;
  canApply: boolean;
  messages: Messages["evidence"];
  onApply: (values: { mentioned: Tri; recommended: Tri; officialSiteCited: Tri; reason: string }) => void;
  onDismiss: () => void;
}) {
  const [mentioned, setMentioned] = useState<Tri>(draft.mentioned);
  const [recommended, setRecommended] = useState<Tri>(draft.recommended);
  const [officialSiteCited, setOfficial] = useState<Tri>(draft.officialSiteCited);
  const [reason, setReason] = useState("");

  function select(label: string, value: Tri, onChange: (next: Tri) => void) {
    return (
      <label className="block space-y-1 text-sm">
        <span>{label}</span>
        <select
          className="w-full rounded-md border bg-background px-2 py-1.5"
          value={value}
          disabled={pending}
          onChange={(event) => {
            const next = triState(event.target.value);
            if (next) onChange(next);
          }}
        >
          <option value="true">{messages.true}</option>
          <option value="false">{messages.false}</option>
          <option value="unknown">{messages.unknown}</option>
        </select>
      </label>
    );
  }

  return (
    <form
      className="space-y-3 rounded-lg border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onApply({ mentioned, recommended, officialSiteCited, reason });
      }}
    >
      <p className="text-sm text-muted-foreground">
        {messages.draftModel.replace("{model}", draft.modelName)} · {formatWhen(locale, draft.createdAt)}
      </p>
      {select(messages.mentioned, mentioned, setMentioned)}
      {select(messages.recommended, recommended, setRecommended)}
      {select(messages.officialSiteCited, officialSiteCited, setOfficial)}
      <label className="block space-y-1 text-sm">
        <span>{messages.draftReason}</span>
        <textarea
          className="min-h-20 w-full rounded-md border bg-background px-2 py-1.5"
          value={reason}
          required
          maxLength={1000}
          disabled={pending}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !canApply || reason.trim().length === 0}>{messages.applyDraft}</Button>
        <Button type="button" variant="outline" disabled={pending} onClick={onDismiss}>{messages.dismissDraft}</Button>
      </div>
    </form>
  );
}

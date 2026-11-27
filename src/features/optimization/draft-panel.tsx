"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";

type OpenDraft = {
  id: string;
  brandId: string;
  gapType: string;
  observedGap: string;
  hypothesis: string;
  modelName: string;
  createdAt: string;
};

function readDraft(value: unknown): OpenDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = Object.fromEntries(Object.entries(value));
  if (typeof draft.id !== "string" || typeof draft.brandId !== "string" || typeof draft.gapType !== "string") return null;
  if (typeof draft.observedGap !== "string" || typeof draft.hypothesis !== "string") return null;
  if (typeof draft.modelName !== "string" || typeof draft.createdAt !== "string") return null;
  return {
    id: draft.id,
    brandId: draft.brandId,
    gapType: draft.gapType,
    observedGap: draft.observedGap,
    hypothesis: draft.hypothesis,
    modelName: draft.modelName,
    createdAt: draft.createdAt,
  };
}

function formatWhen(locale: Locale, value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function ActionDraftPanel({
  locale,
  brandId,
  evidenceIds,
  drafts,
  canWrite = true,
  messages,
}: {
  locale: Locale;
  brandId: string;
  evidenceIds?: string[];
  drafts: OpenDraft[];
  canWrite?: boolean;
  messages: Messages["optimization"];
}) {
  const router = useRouter();
  const [openDrafts, setOpenDrafts] = useState(drafts);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function post(body: unknown, onOk: (payload: { draft?: unknown }) => void) {
    setError(null);
    setNotice(null);
    start(async () => {
      const response = await fetch("/api/optimization/tasks", {
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
    <section className="space-y-3 rounded-2xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{messages.actionDraft}</h2>
        {canWrite && evidenceIds && evidenceIds.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => post({
              action: "draft-from-evidence",
              brandId,
              operationId: crypto.randomUUID(),
              evidenceIds,
            }, (payload) => {
              const draft = readDraft(payload.draft);
              if (!draft) return;
              setOpenDrafts((current) => [draft, ...current.filter((item) => item.id !== draft.id)].slice(0, 20));
              setNotice(messages.actionDraftReady);
            })}
          >
            {pending ? messages.generatingActionDraft : messages.generateActionDraft}
          </Button>
        ) : null}
      </div>
      <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{messages.actionDraftHint}</p>
      {openDrafts.length === 0 ? <p className="text-sm text-muted-foreground">{messages.actionDraftEmpty}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p role="status" className="text-sm">{notice}</p> : null}
      <ul className="space-y-3">
        {openDrafts.map((draft) => (
          <li key={draft.id}>
            {canWrite ? (
              <DraftEditor
                locale={locale}
                draft={draft}
                pending={pending}
                messages={messages}
                onConfirm={(values) => post({
                  action: "confirm-action-draft",
                  brandId: draft.brandId,
                  draftId: draft.id,
                  operationId: crypto.randomUUID(),
                  ...values,
                }, () => {
                  setOpenDrafts((current) => current.filter((item) => item.id !== draft.id));
                  setNotice(messages.draftConfirmed);
                })}
                onDismiss={() => post({
                  action: "dismiss-action-draft",
                  brandId: draft.brandId,
                  draftId: draft.id,
                  operationId: crypto.randomUUID(),
                }, () => {
                  setOpenDrafts((current) => current.filter((item) => item.id !== draft.id));
                  setNotice(messages.draftDismissed);
                })}
              />
            ) : (
              <article className="space-y-2 rounded-xl border px-4 py-4 text-sm">
                <p className="text-muted-foreground">
                  {messages.draftModel.replace("{model}", draft.modelName)} · {draft.gapType} · {formatWhen(locale, draft.createdAt)}
                </p>
                <p><span className="font-medium">{messages.observedGap}:</span> {draft.observedGap}</p>
                <p><span className="font-medium">{messages.hypothesis}:</span> {draft.hypothesis}</p>
              </article>
            )}
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
  messages,
  onConfirm,
  onDismiss,
}: {
  locale: Locale;
  draft: OpenDraft;
  pending: boolean;
  messages: Messages["optimization"];
  onConfirm: (values: { observedGap: string; hypothesis: string }) => void;
  onDismiss: () => void;
}) {
  const [observedGap, setObservedGap] = useState(draft.observedGap);
  const [hypothesis, setHypothesis] = useState(draft.hypothesis);

  return (
    <form
      className="space-y-3 rounded-xl border px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm({ observedGap: observedGap.trim(), hypothesis: hypothesis.trim() });
      }}
    >
      <p className="text-sm text-muted-foreground">
        {messages.draftModel.replace("{model}", draft.modelName)} · {draft.gapType} · {formatWhen(locale, draft.createdAt)}
      </p>
      <label className="block space-y-1 text-sm">
        <span>{messages.observedGap}</span>
        <textarea
          className="min-h-20 w-full rounded-md border bg-background px-3 py-2"
          value={observedGap}
          required
          maxLength={500}
          disabled={pending}
          onChange={(event) => setObservedGap(event.target.value)}
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>{messages.hypothesis}</span>
        <textarea
          className="min-h-20 w-full rounded-md border bg-background px-3 py-2"
          value={hypothesis}
          required
          maxLength={500}
          disabled={pending}
          onChange={(event) => setHypothesis(event.target.value)}
        />
      </label>
      <p className="text-sm text-muted-foreground">{messages.confirmHint}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || observedGap.trim().length === 0 || hypothesis.trim().length === 0}>
          {messages.confirmDraft}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={onDismiss}>
          {messages.dismissDraft}
        </Button>
      </div>
    </form>
  );
}

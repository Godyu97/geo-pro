"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  approveChannelVariantAction,
  blockChannelVariantAction,
  exportChannelVariantAction,
  saveChannelVariantAction,
} from "./actions";

export type ChannelVariantView = {
  id: string;
  channel: string;
  bodyMarkdown: string;
  approvalStatus: "draft" | "approved";
  needsOwnApproval: boolean;
  blocked: boolean;
  rejection: "master_unapproved" | "body_diverged" | "variant_unapproved" | "channel_blocked" | null;
};

type Copy = {
  channel: string;
  body: string;
  status: string;
  draft: string;
  approved: string;
  blocked: string;
  reason: string;
  none: string;
  master_unapproved: string;
  body_diverged: string;
  variant_unapproved: string;
  channel_blocked: string;
  save: string;
  approve: string;
  block: string;
  export: string;
  saved: string;
  exported: string;
  empty: string;
  unsaved: string;
  hint: string;
  errors: Record<string, string>;
};

const inputClass = "h-10 w-full rounded-md border bg-background px-3";
const areaClass = "w-full rounded-md border bg-background px-3 py-2";

// Locale refresh replaces server copy but must not remount this editor.
// The map keeps unsubmitted bodies if the client tree is reconciled again.
const draftMemory = new Map<string, { channel: string; drafts: Record<string, string> }>();

export function ChannelVariantEditor({
  versionId,
  brandId,
  variants,
  readOnly,
  copy,
}: {
  versionId: string;
  brandId: string;
  variants: ChannelVariantView[];
  readOnly: boolean;
  copy: Copy;
}) {
  const router = useRouter();
  const serverDrafts = Object.fromEntries(variants.map((item) => [item.channel, item.bodyMarkdown]));
  const remembered = draftMemory.get(versionId);
  const [channel, setChannel] = useState(remembered?.channel ?? variants[0]?.channel ?? "zhihu");
  const [drafts, setDrafts] = useState<Record<string, string>>(remembered?.drafts ?? serverDrafts);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function persist(nextChannel: string, nextDrafts: Record<string, string>) {
    draftMemory.set(versionId, { channel: nextChannel, drafts: nextDrafts });
  }

  function updateBody(value: string) {
    const next = { ...drafts, [channel]: value };
    setDrafts(next);
    persist(channel, next);
    setFeedback(null);
  }

  function updateChannel(value: string) {
    setChannel(value);
    persist(value, drafts);
    setFeedback(null);
    setError(null);
  }

  const saved = variants.find((item) => item.channel === channel) ?? null;
  const body = drafts[channel] ?? "";
  const unsaved = saved ? saved.bodyMarkdown !== body : body.length > 0;
  const reason = !saved ? copy.empty : saved.rejection ? copy[saved.rejection] : copy.none;

  async function run(
    action: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>,
    kind: "save" | "approve" | "block" | "export",
  ) {
    if (pending) return;
    setPending(true);
    setError(null);
    setFeedback(null);
    const formData = new FormData();
    formData.set("brandId", brandId);
    formData.set("versionId", versionId);
    formData.set("channel", channel);
    formData.set("bodyMarkdown", body);
    try {
      const result = await action(formData);
      if (!result.ok) {
        setError(copy.errors[result.error] ?? copy.errors.INVALID_INPUT ?? result.error);
        return;
      }
      if (kind === "save") setFeedback(copy.saved);
      else if (kind === "export") setFeedback(copy.exported);
      router.refresh();
    } catch {
      setError(copy.errors.SERVICE_UNAVAILABLE ?? copy.errors.INVALID_INPUT ?? "");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{copy.hint}</p>
      {variants.length === 0 ? <p className="text-sm text-muted-foreground">{copy.empty}</p> : (
        <ul className="space-y-3">
          {variants.map((item) => (
            <li key={item.id} className="rounded-2xl border p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => updateChannel(item.channel)}>
                  {item.channel}
                </button>
                <span>{item.approvalStatus === "approved" ? copy.approved : copy.draft}</span>
              </div>
              <p className="mt-2 text-muted-foreground">
                {copy.reason}: {item.rejection ? copy[item.rejection] : copy.none}
                {item.blocked ? ` · ${copy.blocked}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      <form
        className="grid gap-3 rounded-2xl border p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void run(saveChannelVariantAction, "save");
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">{copy.channel}</span>
          <input
            name="channel"
            required
            pattern="[a-z0-9][a-z0-9_-]*"
            maxLength={64}
            value={channel}
            onChange={(event) => updateChannel(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">{copy.body}</span>
          <textarea
            name="bodyMarkdown"
            required
            rows={12}
            value={body}
            onChange={(event) => updateBody(event.target.value)}
            className={areaClass}
          />
        </label>
        {saved ? (
          <p className="text-sm">
            {copy.status}: {saved.approvalStatus === "approved" ? copy.approved : copy.draft}
            {saved.blocked ? ` · ${copy.blocked}` : ""}
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground" role="status">
          {copy.reason}: {reason}
          {unsaved ? ` · ${copy.unsaved}` : ""}
        </p>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {feedback ? <p role="status" className="text-sm">{feedback}</p> : null}
        {readOnly ? null : (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>{copy.save}</Button>
            <Button type="button" variant="outline" disabled={pending || !saved} onClick={() => void run(approveChannelVariantAction, "approve")}>
              {copy.approve}
            </Button>
            <Button type="button" variant="outline" disabled={pending || !saved} onClick={() => void run(blockChannelVariantAction, "block")}>
              {copy.block}
            </Button>
            <Button type="button" variant="secondary" disabled={pending || !saved} onClick={() => void run(exportChannelVariantAction, "export")}>
              {copy.export}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}

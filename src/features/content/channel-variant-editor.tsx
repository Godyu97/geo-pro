"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  approveChannelVariantAction,
  blockChannelVariantAction,
  exportChannelVariantAction,
  saveChannelVariantAction,
} from "./actions";

export type ChannelVariantNext = {
  kind: "empty" | "diverged" | "unapproved" | "export" | "master" | "blocked" | "readonly";
  channel: string;
};

export type ChannelVariantView = {
  id: string;
  channel: string;
  bodyMarkdown: string;
  approvalStatus: "draft" | "approved";
  needsOwnApproval: boolean;
  blocked: boolean;
  rejection: "master_unapproved" | "body_diverged" | "variant_unapproved" | "channel_blocked" | null;
  channelProfileVersionId: string | null;
  pinLabel: string;
};

type ProfileOption = {
  id: string;
  channelKey: string;
  label: string;
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
  pin: string;
  pinRequired: string;
  errors: Record<string, string>;
};

const inputClass = "h-10 w-full min-w-0 max-w-full rounded-md border bg-background px-3";
const areaClass = "w-full min-w-0 max-w-full overflow-x-auto rounded-md border bg-background px-3 py-2";
const buttonClass = "h-auto max-w-full whitespace-normal";

// Locale refresh replaces server copy but must not remount this editor.
// The map keeps unsubmitted bodies if the client tree is reconciled again.
const draftMemory = new Map<string, { channel: string; drafts: Record<string, string>; pins: Record<string, string> }>();

export function ChannelVariantPrimary({
  next,
  brandId,
  versionId,
  versionHref,
  className,
  copy,
}: {
  next: ChannelVariantNext;
  brandId: string;
  versionId: string;
  versionHref: string;
  className: string;
  copy: { save: string; approve: string; export: string; back: string; errors: Record<string, string> };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (next.kind === "empty" || next.kind === "diverged") {
    return <Button type="submit" form="channel-variant-form" className={className}>{copy.save}</Button>;
  }
  if (next.kind === "master" || next.kind === "blocked" || next.kind === "readonly") {
    return (
      <Button asChild className={className}>
        <Link href={versionHref} prefetch={false}>{copy.back}</Link>
      </Button>
    );
  }
  const action = next.kind === "unapproved" ? approveChannelVariantAction : exportChannelVariantAction;
  const label = next.kind === "unapproved" ? copy.approve : copy.export;
  return (
    <div className="min-w-0 space-y-2">
      <Button
        type="button"
        className={className}
        disabled={pending || next.channel.length === 0}
        onClick={() => {
          if (pending) return;
          setPending(true);
          setError(null);
          const formData = new FormData();
          formData.set("brandId", brandId);
          formData.set("versionId", versionId);
          formData.set("channel", next.channel);
          void action(formData).then((result) => {
            if (!result.ok) {
              setError(copy.errors[result.error] ?? copy.errors.INVALID_INPUT ?? result.error);
              if (result.error === "IMAGE_RIGHTS_INVALID") router.refresh();
              return;
            }
            router.refresh();
          }).catch(() => {
            setError(copy.errors.SERVICE_UNAVAILABLE ?? copy.errors.INVALID_INPUT ?? "");
          }).finally(() => {
            setPending(false);
          });
        }}
      >
        {label}
      </Button>
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export function ChannelVariantEditor({
  versionId,
  brandId,
  next,
  variants,
  profiles,
  readOnly,
  copy,
}: {
  versionId: string;
  brandId: string;
  next: ChannelVariantNext;
  variants: ChannelVariantView[];
  profiles: ProfileOption[];
  readOnly: boolean;
  copy: Copy;
}) {
  const router = useRouter();
  const serverDrafts = Object.fromEntries(variants.map((item) => [item.channel, item.bodyMarkdown]));
  const serverPins = Object.fromEntries(variants.flatMap((item) => item.channelProfileVersionId ? [[item.channel, item.channelProfileVersionId]] : []));
  const remembered = draftMemory.get(versionId);
  const initialChannel = remembered?.channel ?? (next.channel || variants[0]?.channel || "");
  const [channel, setChannel] = useState(initialChannel);
  const [drafts, setDrafts] = useState<Record<string, string>>(remembered?.drafts ?? serverDrafts);
  const [pins, setPins] = useState<Record<string, string>>(remembered?.pins ?? serverPins);
  const [profileVersionId, setProfileVersionId] = useState(remembered?.pins?.[initialChannel] ?? serverPins[initialChannel] ?? "");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function persist(nextChannel: string, nextDrafts: Record<string, string>, nextPins: Record<string, string>) {
    draftMemory.set(versionId, { channel: nextChannel, drafts: nextDrafts, pins: nextPins });
  }

  function updateBody(value: string) {
    const next = { ...drafts, [channel]: value };
    setDrafts(next);
    persist(channel, next, pins);
    setFeedback(null);
  }

  function updateChannel(value: string) {
    const savedPin = variants.find((item) => item.channel === value);
    const nextPin = savedPin ? (savedPin.channelProfileVersionId ?? "") : (pins[value] ?? "");
    setChannel(value);
    setProfileVersionId(nextPin);
    persist(value, drafts, pins);
    setFeedback(null);
    setError(null);
  }

  function updatePin(value: string) {
    const nextPins = { ...pins, [channel]: value };
    setPins(nextPins);
    setProfileVersionId(value);
    persist(channel, drafts, nextPins);
    setFeedback(null);
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
    if (profileVersionId) formData.set("profileVersionId", profileVersionId);
    try {
      const result = await action(formData);
      if (!result.ok) {
        setError(copy.errors[result.error] ?? copy.errors.INVALID_INPUT ?? result.error);
        if (result.error === "IMAGE_RIGHTS_INVALID") router.refresh();
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

  const primarySaves = next.kind === "empty" || next.kind === "diverged";
  const showSecondaryApprove = Boolean(saved)
    && next.kind !== "unapproved"
    && saved?.rejection != null
    && saved.rejection !== "channel_blocked";

  return (
    <div className="min-w-0 max-w-full space-y-6">
      <p className="max-w-2xl break-words text-sm leading-6 text-muted-foreground">{copy.hint}</p>
      {variants.length === 0 ? <p className="rounded-xl border border-dashed px-4 py-5 text-sm leading-6 text-muted-foreground">{copy.empty}</p> : (
        <ul className="min-w-0 space-y-3">
          {variants.map((item) => (
            <li key={item.id} className="min-w-0 rounded-2xl border bg-card p-4 text-sm">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <button type="button" className="max-w-full break-all text-left font-medium underline-offset-4 hover:underline" onClick={() => updateChannel(item.channel)}>
                  {item.channel}
                </button>
                <span>{item.approvalStatus === "approved" ? copy.approved : copy.draft}</span>
              </div>
              <p className="mt-2 text-muted-foreground">
                {copy.pin}: {item.pinLabel}
              </p>
              <p className="mt-2 text-muted-foreground">
                {copy.reason}: {item.rejection ? copy[item.rejection] : copy.none}
                {item.blocked ? ` · ${copy.blocked}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      <form
        id="channel-variant-form"
        className="grid min-w-0 max-w-full gap-3 rounded-2xl border bg-card p-5"
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
        {saved ? (
          <p className="text-sm">{copy.pin}: {saved.pinLabel}</p>
        ) : (
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{copy.pin}</span>
            <select
              name="profileVersionId"
              required
              value={profileVersionId}
              onChange={(event) => updatePin(event.target.value)}
              className={inputClass}
            >
              <option value="">{copy.pinRequired}</option>
              {profiles.filter((item) => item.channelKey === channel).map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
        )}
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
        {readOnly || (!primarySaves && !showSecondaryApprove && !saved) ? null : (
          <div className="flex min-w-0 flex-wrap gap-2">
            {primarySaves ? null : (
              <Button type="submit" disabled={pending} className={buttonClass}>{copy.save}</Button>
            )}
            {showSecondaryApprove ? (
              <Button type="button" variant="outline" disabled={pending || !saved} className={buttonClass} onClick={() => void run(approveChannelVariantAction, "approve")}>
                {copy.approve}
              </Button>
            ) : null}
            {saved ? (
              <Button type="button" variant="outline" disabled={pending} className={buttonClass} onClick={() => void run(blockChannelVariantAction, "block")}>
                {copy.block}
              </Button>
            ) : null}
          </div>
        )}
      </form>
    </div>
  );
}

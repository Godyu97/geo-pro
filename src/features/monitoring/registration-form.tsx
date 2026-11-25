"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import type { PreviewSnapshot } from "./contracts";
import { formatMinorUnits } from "./format";

type Copy = Messages["monitoring"];
type SetOption = { id: string; version: number; region: string; language: string; questionCount: number; naturalCount: number };
type ChannelOption = { channelId: string; kind: "model_api" | "consumer_ui" | "custom_pipeline"; displayName: string; eligibility: string; version: number };
type GrantOption = { version: number; currency: string; countLimit: number; budgetMinor: number; reserved: number; committedMinor: number } | null;
type RecentRun = {
  id: string; track: "model_api" | "consumer_ui"; questionCount: number; naturalCount: number;
  channelCount: number; repeatCount: number; slotCount: number; createdAt: string;
};

const selectClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const inputClass = "h-10 bg-background";
const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center aria-disabled:opacity-60";

const nextMessage = {
  "adjust-scope": "QUOTA_INSUFFICIENT",
  "refresh-preview": "PREVIEW_EXPIRED",
  "verify-email": "EMAIL_UNVERIFIED",
  "verify-channel": "CHANNEL_UNVERIFIED",
  "confirm-ceiling": "NO_TRUSTED_CEILING",
  "request-quota": "NOT_ENTITLED",
  "add-primary": "NOT_READY",
} as const;

export function RegistrationForm({
  locale, messages, brandId, brandName, sets, channels, grant, recent, emailVerified,
}: {
  locale: Locale;
  messages: Copy;
  brandId: string;
  brandName: string;
  sets: SetOption[];
  channels: ChannelOption[];
  grant: GrantOption;
  recent: RecentRun[];
  emailVerified: boolean;
}) {
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const [setId, setSetId] = useState(sets[0]?.id ?? "");
  const [track, setTrack] = useState<"model_api" | "consumer_ui">("model_api");
  const [selected, setSelected] = useState<string[]>([]);
  const [repeats, setRepeats] = useState(1);
  const [network, setNetwork] = useState<"on" | "off" | "unknown">("unknown");
  const [currency, setCurrency] = useState(grant?.currency ?? "CNY");
  const [upper, setUpper] = useState("");
  const [preview, setPreview] = useState<{ snapshot: PreviewSnapshot; token: string; operationId: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const visible = channels.filter((item) => item.kind === track);

  function edit(update: () => void) {
    update();
    setPreview(null);
    setStatus(null);
  }

  async function submit(action: "preview" | "accept") {
    if (pending) return;
    if (action === "accept" && !preview) return;
    if (action === "preview" && track === "model_api" && !/^\d+$/.test(upper.trim())) {
      setStatus(t("NO_TRUSTED_CEILING"));
      return;
    }
    setPending(true);
    setStatus(null);
    const ceiling = track === "model_api" ? { currency, upperMinor: Number(upper) } : null;
    const body = action === "preview" || !preview ? {
      action: "preview", brandId, track, promptSetId: setId, repeats, requestedNetworkMode: network,
      channelIds: selected, ceiling,
    } : { action: "accept", ...preview.snapshot, token: preview.token, operationId: preview.operationId };
    try {
      const response = await fetch("/api/monitoring/runs", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as {
        error?: { code?: keyof Copy; message?: string };
        next?: keyof typeof nextMessage | null;
        snapshot?: PreviewSnapshot;
        token?: string;
        id?: string;
        replayed?: boolean;
      };
      if (!response.ok) {
        const code = payload.next ? nextMessage[payload.next] : payload.error?.code;
        if (payload.next === "refresh-preview") setPreview(null);
        setStatus(code && code in messages ? t(code) : payload.error?.message ?? t("SERVICE_UNAVAILABLE"));
        return;
      }
      if (payload.snapshot && payload.token) {
        setPreview({ snapshot: payload.snapshot, token: payload.token, operationId: crypto.randomUUID() });
        setStatus(null);
        return;
      }
      setStatus(payload.replayed ? t("replayed") : t("queued"));
      if (payload.id) router.push(`/dashboard/monitoring/runs/${payload.id}`);
    } catch {
      setStatus(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  const snapshot = preview?.snapshot;
  const payable = snapshot?.ceiling
    ? formatMinorUnits(locale, 0, snapshot.ceiling.currency)
    : formatNumber(locale, 0);
  return (
    <form className="min-w-0 space-y-5" onSubmit={(event) => event.preventDefault()}>
      <fieldset disabled={pending} className="min-w-0 space-y-4">
        {!emailVerified && (
          <p className="rounded-xl border border-dashed bg-muted/20 px-3.5 py-2.5 text-sm leading-6 text-muted-foreground">
            {t("verifyEmail")}
          </p>
        )}
        <label className="block min-w-0 space-y-1.5 text-sm">
          <span className="font-medium">{t("promptSet")}</span>
          <select className={selectClass} value={setId} onChange={(event) => edit(() => setSetId(event.target.value))}>
            {sets.map((item) => (
              <option key={item.id} value={item.id}>
                {t("promptVersion", { version: item.version })} · {t("scope", { region: item.region, language: item.language })}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="min-w-0 space-y-2">
          <legend className="text-sm font-medium">{t("track")}</legend>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {(["model_api", "consumer_ui"] as const).map((item) => (
              <label
                key={item}
                className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-xl border bg-background px-3.5 py-2.5 text-sm transition-colors hover:bg-muted/40 has-checked:border-primary has-checked:bg-primary/5"
              >
                <input
                  type="radio"
                  name="monitoring-track"
                  checked={track === item}
                  onChange={() => edit(() => { setTrack(item); setSelected([]); })}
                  className="size-4 shrink-0 accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">{t(item)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="min-w-0 space-y-2">
          <legend className="text-sm font-medium">{t("channels")}</legend>
          {visible.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-muted/20 px-4 py-4 text-sm leading-6 text-muted-foreground">{t("noChannel")}</p>
          ) : (
            <div className="space-y-2.5">
              {visible.map((item) => (
                <label
                  key={item.channelId}
                  className="flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border bg-background p-3.5 text-sm transition-colors hover:bg-muted/40 has-checked:border-primary has-checked:bg-primary/5"
                >
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 rounded border-input accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    checked={selected.includes(item.channelId)}
                    onChange={(event) => edit(() => setSelected(event.target.checked
                      ? [...selected, item.channelId]
                      : selected.filter((id) => id !== item.channelId)))}
                  />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block font-medium [overflow-wrap:anywhere]">{item.displayName}</span>
                    <span className="block text-muted-foreground">{t(item.eligibility in messages ? item.eligibility as keyof Copy : "CHANNEL_UNVERIFIED")}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="min-w-0 space-y-1.5 text-sm">
            <span className="block font-medium">{t("repeats")}</span>
            <Input
              className={inputClass}
              type="number"
              min={1}
              max={3}
              value={repeats}
              onChange={(event) => edit(() => setRepeats(Number(event.target.value)))}
            />
          </label>
          <label className="min-w-0 space-y-1.5 text-sm">
            <span className="block font-medium">{t("network")}</span>
            <select className={selectClass} value={network} onChange={(event) => edit(() => setNetwork(event.target.value as "on" | "off" | "unknown"))}>
              <option value="on">{t("networkOn")}</option>
              <option value="off">{t("networkOff")}</option>
              <option value="unknown">{t("networkUnknown")}</option>
            </select>
          </label>
        </div>
        {track === "model_api" && (
          <fieldset className="grid min-w-0 gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium">{t("ceiling")}</legend>
            <label className="min-w-0 space-y-1.5 text-sm">
              <span className="block font-medium">{t("currency")}</span>
              <Input
                className={`${inputClass} uppercase`}
                maxLength={3}
                value={currency}
                onChange={(event) => edit(() => setCurrency(event.target.value.toUpperCase()))}
              />
            </label>
            <label className="min-w-0 space-y-1.5 text-sm">
              <span className="block font-medium">{t("upperMinor")}</span>
              <Input
                className={inputClass}
                inputMode="numeric"
                value={upper}
                onChange={(event) => edit(() => setUpper(event.target.value))}
              />
            </label>
            {grant && (
              <p className="text-sm leading-6 text-muted-foreground tabular-nums sm:col-span-2">
                {t("grantLine", {
                  version: grant.version,
                  reserved: formatNumber(locale, grant.reserved),
                  limit: formatNumber(locale, grant.countLimit),
                  budget: formatMinorUnits(locale, grant.budgetMinor, grant.currency),
                })}
              </p>
            )}
          </fieldset>
        )}
      </fieldset>
      {snapshot && (
        <div className="min-w-0 space-y-2 rounded-xl border bg-muted/30 p-4 text-sm leading-6 sm:p-5">
          <p className="font-medium [overflow-wrap:anywhere]">{t("previewBrand", { name: brandName })}</p>
          <p>{t("previewScope", {
            version: formatNumber(locale, snapshot.promptSetVersion),
            region: snapshot.region,
            language: snapshot.language,
          })}</p>
          <ul className="space-y-1">
            {snapshot.channels.map((channel) => (
              <li key={channel.channelId} className="[overflow-wrap:anywhere]">{t("previewChannel", {
                name: channels.find((item) => item.channelId === channel.channelId)?.displayName ?? channel.channelId,
                version: formatNumber(locale, channel.version),
              })}</li>
            ))}
          </ul>
          <p>{t("previewMode", {
            track: t(snapshot.track),
            mode: t(snapshot.requestedNetworkMode === "on" ? "networkOn" : snapshot.requestedNetworkMode === "off" ? "networkOff" : "networkUnknown"),
            repeats: formatNumber(locale, snapshot.repeats),
          })}</p>
          <p className="tabular-nums">{t("previewSummary", {
            questions: formatNumber(locale, snapshot.questionCount),
            natural: formatNumber(locale, snapshot.naturalCount),
            channels: formatNumber(locale, snapshot.channels.length),
            repeats: formatNumber(locale, snapshot.repeats),
            slots: formatNumber(locale, snapshot.questionCount * snapshot.channels.length * snapshot.repeats),
          })}</p>
          <p className="text-muted-foreground">{t("recheckNote")}</p>
          <div className="space-y-1 border-t pt-2 tabular-nums">
            <p>{t("customerPayable", { amount: payable })}</p>
            {snapshot.ceiling ? (
              <>
                <p>{t("trustedCeiling", { amount: formatMinorUnits(locale, snapshot.ceiling.upperMinor, snapshot.ceiling.currency) })}</p>
                <p>{t("estimateHigh", { amount: formatMinorUnits(locale, snapshot.ceiling.upperMinor * snapshot.questionCount * snapshot.channels.length * snapshot.repeats, snapshot.ceiling.currency) })}</p>
                <p>{t("estimateLow")}</p>
                <p>{t("actualUnknown")}</p>
              </>
            ) : <p>{t("notCharged")}</p>}
          </div>
        </div>
      )}
      {status && (
        <p role="status" className="rounded-xl border bg-muted/30 px-3.5 py-2.5 text-sm leading-6 [overflow-wrap:anywhere]">
          {status}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className={actionClass}
          disabled={pending || !setId || selected.length === 0}
          aria-disabled={pending || !setId || selected.length === 0}
          onClick={() => void submit("preview")}
        >
          {t("preview")}
        </Button>
        <Button
          type="button"
          className={actionClass}
          disabled={pending || !preview}
          aria-disabled={pending || !preview}
          onClick={() => void submit("accept")}
        >
          {t("accept")}
        </Button>
      </div>
      <section className="min-w-0 space-y-3 border-t pt-4" aria-labelledby="recent-runs">
        <h3 id="recent-runs" className="text-sm font-semibold">{t("recent")}</h3>
        {recent.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-muted/20 px-4 py-4 text-sm leading-6 text-muted-foreground">{t("emptyRecent")}</p>
        ) : (
          <ul className="space-y-2.5 text-sm">
            {recent.map((item) => (
              <li key={item.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border bg-background p-3.5">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium">{t(item.track)}</p>
                  <p className="text-muted-foreground tabular-nums [overflow-wrap:anywhere]">
                    {t("previewSummary", {
                      questions: formatNumber(locale, item.questionCount),
                      natural: formatNumber(locale, item.naturalCount),
                      channels: formatNumber(locale, item.channelCount),
                      repeats: formatNumber(locale, item.repeatCount),
                      slots: formatNumber(locale, item.slotCount),
                    })}
                  </p>
                </div>
                <Button asChild size="sm" variant="outline" className="h-auto min-h-9 max-w-full whitespace-normal text-center">
                  <Link href={`/dashboard/monitoring/runs/${item.id}`} prefetch={false}>
                    {t("openRun", { id: item.id.slice(0, 8) })}
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </form>
  );
}

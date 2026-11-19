"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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
  locale, messages, brandId, sets, channels, grant, recent, emailVerified,
}: {
  locale: Locale;
  messages: Copy;
  brandId: string;
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
  }

  async function submit(action: "preview" | "accept") {
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
    <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
      {!emailVerified && <p className="text-sm text-muted-foreground">{t("verifyEmail")}</p>}
      <label className="block space-y-1 text-sm">
        <span className="font-medium">{t("promptSet")}</span>
        <select className="w-full rounded-lg border bg-background px-3 py-2" value={setId} onChange={(event) => edit(() => setSetId(event.target.value))}>
          {sets.map((item) => (
            <option key={item.id} value={item.id}>
              {t("promptVersion", { version: item.version })} · {t("scope", { region: item.region, language: item.language })}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("track")}</legend>
        {(["model_api", "consumer_ui"] as const).map((item) => (
          <label key={item} className="flex items-center gap-2 text-sm">
            <input type="radio" name="monitoring-track" checked={track === item} onChange={() => edit(() => { setTrack(item); setSelected([]); })} />
            {t(item)}
          </label>
        ))}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("channels")}</legend>
        {visible.length === 0 && <p className="text-sm text-muted-foreground">{t("noChannel")}</p>}
        {visible.map((item) => (
          <label key={item.channelId} className="flex min-w-0 items-start gap-2 rounded-lg border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={selected.includes(item.channelId)}
              onChange={(event) => edit(() => setSelected(event.target.checked
                ? [...selected, item.channelId]
                : selected.filter((id) => id !== item.channelId)))}
            />
            <span className="min-w-0">
              <span className="block font-medium wrap-anywhere">{item.displayName}</span>
              <span className="text-muted-foreground">{t(item.eligibility in messages ? item.eligibility as keyof Copy : "CHANNEL_UNVERIFIED")}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">{t("repeats")}</span>
          <input className="w-full rounded-lg border bg-background px-3 py-2" type="number" min={1} max={3} value={repeats}
            onChange={(event) => edit(() => setRepeats(Number(event.target.value)))} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">{t("network")}</span>
          <select className="w-full rounded-lg border bg-background px-3 py-2" value={network} onChange={(event) => edit(() => setNetwork(event.target.value as "on" | "off" | "unknown"))}>
            <option value="on">{t("networkOn")}</option>
            <option value="off">{t("networkOff")}</option>
            <option value="unknown">{t("networkUnknown")}</option>
          </select>
        </label>
      </div>
      {track === "model_api" && (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="text-sm font-medium sm:col-span-2">{t("ceiling")}</legend>
          <label className="space-y-1 text-sm">
            <span className="block">{t("currency")}</span>
            <input className="w-full rounded-lg border bg-background px-3 py-2 uppercase" maxLength={3} value={currency}
              onChange={(event) => edit(() => setCurrency(event.target.value.toUpperCase()))} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block">{t("upperMinor")}</span>
            <input className="w-full rounded-lg border bg-background px-3 py-2" inputMode="numeric" value={upper}
              onChange={(event) => edit(() => setUpper(event.target.value))} />
          </label>
          {grant && <p className="text-sm text-muted-foreground sm:col-span-2">{t("grantLine", {
            version: grant.version, reserved: formatNumber(locale, grant.reserved), limit: formatNumber(locale, grant.countLimit),
            budget: formatMinorUnits(locale, grant.budgetMinor, grant.currency),
          })}</p>}
        </fieldset>
      )}
      {snapshot && (
        <div className="space-y-1 rounded-lg border p-3 text-sm">
          <p>{t("previewSummary", {
            questions: formatNumber(locale, snapshot.questionCount),
            natural: formatNumber(locale, snapshot.naturalCount),
            channels: formatNumber(locale, snapshot.channels.length),
            repeats: formatNumber(locale, snapshot.repeats),
            slots: formatNumber(locale, snapshot.questionCount * snapshot.channels.length * snapshot.repeats),
          })}</p>
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
      )}
      {status && <p role="status" className="text-sm">{status}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending || !setId || selected.length === 0} onClick={() => void submit("preview")}>{t("preview")}</Button>
        <Button type="button" disabled={pending || !preview} onClick={() => void submit("accept")}>{t("accept")}</Button>
      </div>
      <section className="space-y-2" aria-labelledby="recent-runs">
        <h3 id="recent-runs" className="text-sm font-medium">{t("recent")}</h3>
        {recent.length === 0 && <p className="text-sm text-muted-foreground">{t("emptyRecent")}</p>}
        <ul className="space-y-1 text-sm">
          {recent.map((item) => (
            <li key={item.id}>
              <Link className="underline underline-offset-4" href={`/dashboard/monitoring/runs/${item.id}`} prefetch={false}>
                {t("openRun", { id: item.id.slice(0, 8) })}
              </Link>
              <span className="text-muted-foreground"> · {t(item.track)} · {t("previewSummary", {
                questions: formatNumber(locale, item.questionCount),
                natural: formatNumber(locale, item.naturalCount),
                channels: formatNumber(locale, item.channelCount),
                repeats: formatNumber(locale, item.repeatCount),
                slots: formatNumber(locale, item.slotCount),
              })}</span>
            </li>
          ))}
        </ul>
      </section>
    </form>
  );
}

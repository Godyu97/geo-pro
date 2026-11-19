"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import type { UserCapability } from "./contracts";

export function RunConfirmForm({
  locale, messages, channels,
}: {
  locale: Locale;
  messages: Messages["capabilities"];
  channels: UserCapability[];
}) {
  const t = createTranslator(locale, messages);
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(space: "formal" | "demo") {
    setPending(true);
    setResult(null);
    const selected = [...document.querySelectorAll<HTMLInputElement>("input[name=channel]:checked")].map((item) => item.value);
    try {
      const response = await fetch("/api/monitoring/runs", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ space, channelIds: selected }),
      });
      const body = await response.json() as { error?: { message?: string; code?: string }; reason?: string };
      if (body.error?.code === "CHANNEL_UNVERIFIED") setResult(t("CHANNEL_UNVERIFIED"));
      else if (body.error?.code === "INVALID_INPUT") setResult(t("INVALID_INPUT"));
      else if (space === "demo") setResult(t("demoNotFormal"));
      else if (body.reason === "RUN_NOT_OPEN" || body.error?.code === "RUN_NOT_OPEN") setResult(t("RUN_NOT_OPEN"));
      else setResult(body.error?.message ?? t("SERVICE_UNAVAILABLE"));
    } catch {
      setResult(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {channels.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("selectChannels")}</legend>
        {channels.map((item) => (
          <label key={item.channelId} className="flex min-w-0 items-start gap-2 rounded-lg border p-3 text-sm">
            <input type="checkbox" name="channel" value={item.channelId} className="mt-1" />
            <span className="min-w-0">
              <span className="block font-medium wrap-anywhere">{item.displayName}</span>
              <span className="text-muted-foreground">{t(item.kind)} · {t(item.eligibility)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {result && <p role="status" className="text-sm">{result}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} onClick={() => void submit("formal")}>{t("confirmFormal")}</Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => void submit("demo")}>{t("confirmDemo")}</Button>
      </div>
    </div>
  );
}

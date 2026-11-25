"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import type { UserCapability } from "./contracts";

const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center aria-disabled:opacity-60";

export function RunConfirmForm({
  locale, messages, channels,
}: {
  locale: Locale;
  messages: Messages["capabilities"];
  channels: UserCapability[];
}) {
  const t = createTranslator(locale, messages);
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(space: "formal" | "demo") {
    if (pending) return;
    setPending(true);
    setResult(null);
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
    <CardContent className="min-w-0 space-y-4 p-5 sm:p-6">
      <h2 className="text-base font-semibold tracking-tight">{t("channelEligibilityTitle")}</h2>
      {channels.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-muted/20 px-4 py-5 text-sm leading-6 text-muted-foreground">{t("empty")}</p>
      ) : (
        <fieldset disabled={pending} className="min-w-0 space-y-2.5">
          <legend className="text-sm font-medium">{t("selectChannels")}</legend>
          {channels.map((item) => (
            <label
              key={item.channelId}
              className="flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border bg-background p-3.5 text-sm transition-colors hover:bg-muted/40 has-checked:border-primary has-checked:bg-primary/5"
            >
              <input
                type="checkbox"
                name="channel"
                value={item.channelId}
                checked={selected.includes(item.channelId)}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setSelected((current) => checked
                    ? [...current, item.channelId]
                    : current.filter((id) => id !== item.channelId));
                }}
                className="mt-1 size-4 shrink-0 rounded border-input accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <span className="min-w-0 flex-1 space-y-1.5">
                <span className="block font-medium [overflow-wrap:anywhere]">{item.displayName}</span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{t(item.kind)}</Badge>
                  <Badge variant={item.eligibility === "eligible" ? "secondary" : "outline"}>{t(item.eligibility)}</Badge>
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {result && (
        <p role="status" className="rounded-xl border bg-muted/30 px-3.5 py-2.5 text-sm leading-6 [overflow-wrap:anywhere]">
          {result}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" className={actionClass} disabled={pending} aria-disabled={pending} onClick={() => void submit("formal")}>
          {t("confirmFormal")}
        </Button>
        <Button type="button" variant="outline" className={actionClass} disabled={pending} aria-disabled={pending} onClick={() => void submit("demo")}>
          {t("confirmDemo")}
        </Button>
      </div>
    </CardContent>
  );
}

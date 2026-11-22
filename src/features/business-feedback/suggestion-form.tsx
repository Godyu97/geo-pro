"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";

type Copy = Messages["leadSuggestions"];

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as { error?: { code?: keyof Copy } };
  return { ok: response.ok, code: payload.error?.code };
}

export function DraftLeadSuggestionsForm({
  locale,
  messages,
  brandId,
}: {
  locale: Locale;
  messages: Copy;
  brandId: string;
}) {
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function submit(form: FormData) {
    setPending(true);
    setStatus(null);
    try {
      const result = await postJson("/api/reports/lead-suggestions", {
        brandId,
        summary: String(form.get("summary") ?? ""),
      });
      if (!result.ok) {
        const code = result.code;
        setStatus(code && code in messages ? t(code) : t("SERVICE_UNAVAILABLE"));
        return;
      }
      setStatus(t("drafted"));
      router.refresh();
    } catch {
      setStatus(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-4 rounded-2xl border p-5" onSubmit={(event) => {
      event.preventDefault();
      void submit(new FormData(event.currentTarget));
    }}>
      <h2 className="text-lg font-semibold">{t("draftTitle")}</h2>
      <label className="grid gap-2 text-sm">
        <span>{t("summary")}</span>
        <textarea name="summary" required minLength={8} maxLength={2000} rows={5} className="rounded-md border bg-background px-3 py-2" />
        <span className="text-muted-foreground">{t("summaryHint")}</span>
      </label>
      <div>
        <Button type="submit" disabled={pending}>{pending ? t("drafting") : t("draft")}</Button>
      </div>
      {status ? <p role="alert" className="text-sm">{status}</p> : null}
    </form>
  );
}

export function LeadSuggestionActions({
  locale,
  messages,
  suggestionId,
}: {
  locale: Locale;
  messages: Copy;
  suggestionId: string;
}) {
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const [pending, setPending] = useState<"accept" | "discard" | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function decide(action: "accept" | "discard") {
    setPending(action);
    setStatus(null);
    try {
      const result = await postJson(`/api/reports/lead-suggestions/${suggestionId}`, { action });
      if (!result.ok) {
        const code = result.code;
        setStatus(code && code in messages ? t(code) : t("SERVICE_UNAVAILABLE"));
        return;
      }
      setStatus(t("saved"));
      router.refresh();
    } catch {
      setStatus(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" disabled={pending !== null} onClick={() => void decide("accept")}>
        {pending === "accept" ? t("accepting") : t("accept")}
      </Button>
      <Button type="button" variant="outline" disabled={pending !== null} onClick={() => void decide("discard")}>
        {pending === "discard" ? t("discarding") : t("discard")}
      </Button>
      {status ? <p role="alert" className="text-sm">{status}</p> : null}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Messages } from "@/lib/i18n/server";

type Origin = "search_candidate" | "analyst_found";

const fieldClass = "h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm";

function httpUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function ReferenceLinkForm({
  brandId,
  observationId,
  messages,
}: {
  brandId: string;
  observationId: string;
  messages: Messages["evidence"];
}) {
  const router = useRouter();
  const [rawUrl, setRawUrl] = useState("");
  const [origin, setOrigin] = useState<Origin>("search_candidate");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  return (
    <form
      className="min-w-0 space-y-3 rounded-2xl border bg-card p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setSaved(false);
        const url = httpUrl(rawUrl);
        if (!url) {
          setError(messages.referenceLinkInvalidUrl);
          return;
        }
        start(async () => {
          try {
            const response = await fetch("/api/monitoring/answers", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "append-reference",
                brandId,
                observationId,
                operationId: crypto.randomUUID(),
                rawUrl: url,
                citationOrigin: origin,
              }),
            });
            const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
            if (!response.ok) {
              setError(body?.error?.message ?? messages.SERVICE_UNAVAILABLE);
              return;
            }
            setSaved(true);
            setRawUrl("");
            router.refresh();
          } catch {
            setError(messages.SERVICE_UNAVAILABLE);
          }
        });
      }}
    >
      <div className="min-w-0 space-y-1">
        <h2 className="font-semibold">{messages.referenceLinkTitle}</h2>
        <p className="max-w-2xl text-sm leading-6 break-words text-muted-foreground">{messages.referenceLinkHint}</p>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="reference-link-url">{messages.referenceLinkUrl}</Label>
          <Input
            id="reference-link-url"
            value={rawUrl}
            required
            maxLength={2000}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
            onChange={(event) => setRawUrl(event.target.value)}
          />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="reference-link-origin">{messages.referenceLinkOrigin}</Label>
          <select
            id="reference-link-origin"
            className={fieldClass}
            value={origin}
            disabled={pending}
            onChange={(event) => setOrigin(event.target.value as Origin)}
          >
            <option value="search_candidate">{messages.search_candidate}</option>
            <option value="analyst_found">{messages.analyst_found}</option>
          </select>
        </div>
      </div>
      {error && <p role="alert" className="text-sm break-words text-destructive">{error}</p>}
      {saved && <p role="status" className="text-sm break-words">{messages.referenceLinkSaved}</p>}
      <Button type="submit" className="h-auto max-w-full whitespace-normal text-left" disabled={pending || rawUrl.trim().length === 0}>
        {pending ? messages.referenceLinkSaving : messages.referenceLinkSave}
      </Button>
    </form>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Messages } from "@/lib/i18n/server";

type Tri = "true" | "false" | "unknown";

export function ReviseAnalysisForm({
  brandId,
  observationId,
  expectedVersion,
  initial,
  messages,
}: {
  brandId: string;
  observationId: string;
  expectedVersion: number;
  initial: { mentioned: Tri; recommended: Tri; officialSiteCited: Tri };
  messages: Messages["evidence"];
}) {
  const router = useRouter();
  const [mentioned, setMentioned] = useState<Tri>(initial.mentioned);
  const [recommended, setRecommended] = useState<Tri>(initial.recommended);
  const [officialSiteCited, setOfficial] = useState<Tri>(initial.officialSiteCited);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function select(label: string, value: Tri, onChange: (next: Tri) => void) {
    return (
      <label className="block space-y-1 text-sm">
        <span>{label}</span>
        <select
          className="w-full rounded-md border bg-background px-2 py-1.5"
          value={value}
          onChange={(event) => onChange(event.target.value as Tri)}
          disabled={pending || done}
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
      className="space-y-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        start(async () => {
          const response = await fetch("/api/monitoring/answers", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "revise-analysis",
              brandId,
              observationId,
              expectedVersion,
              operationId: crypto.randomUUID(),
              mentioned,
              recommended,
              officialSiteCited,
              reason,
            }),
          });
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            setError(body?.error?.message ?? messages.SERVICE_UNAVAILABLE);
            return;
          }
          setDone(true);
          router.refresh();
        });
      }}
    >
      <h2 className="font-medium">{messages.revise}</h2>
      {select(messages.mentioned, mentioned, setMentioned)}
      {select(messages.recommended, recommended, setRecommended)}
      {select(messages.officialSiteCited, officialSiteCited, setOfficial)}
      <label className="block space-y-1 text-sm">
        <span>{messages.reviseReason}</span>
        <textarea
          className="min-h-20 w-full rounded-md border bg-background px-2 py-1.5"
          value={reason}
          required
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
          disabled={pending || done}
        />
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {done && <p className="text-sm">{messages.reviseSuccess}</p>}
      <button
        type="submit"
        className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-60"
        disabled={pending || done || reason.trim().length === 0}
      >
        {messages.saveRevision}
      </button>
    </form>
  );
}

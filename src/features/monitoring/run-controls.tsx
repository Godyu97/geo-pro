"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Messages } from "@/lib/i18n/server";

type Copy = Messages["monitoring"];

export function RunControls({
  runId,
  messages,
  succeededSlots,
  unknownAttempts,
  official,
  executePrimary,
  mockRun,
}: {
  runId: string;
  messages: Copy;
  succeededSlots: Array<{ id: string; questionText: string }>;
  unknownAttempts: Array<{ id: string; questionText: string }>;
  official: boolean;
  executePrimary: boolean;
  mockRun: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function send(body: { action: string } & Record<string, unknown>) {
    const setBusy = body.action === "execute" ? setExecuting : setPending;
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/monitoring/runs/${runId}`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: { message?: string }; replayed?: boolean; pausedForBudget?: boolean };
      if (!response.ok) {
        setStatus(payload.error?.message ?? messages.SERVICE_UNAVAILABLE);
        router.refresh();
      }
      else {
        setStatus(payload.pausedForBudget ? messages.PAUSED_FOR_BUDGET : payload.replayed ? messages.replayedControl : messages.savedControl);
        router.refresh();
      }
    } catch {
      setStatus(messages.SERVICE_UNAVAILABLE);
    } finally {
      setBusy(false);
    }
  }

  const receipts = (
    <Button asChild variant={executePrimary || mockRun ? "outline" : "default"}>
      <a href="#run-receipts">{messages.openRunReceipts}</a>
    </Button>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {!executePrimary && receipts}
        {official && (
          <Button
            type="button" variant={executePrimary ? "default" : "outline"}
            aria-describedby="official-sampling-note" disabled={pending || executing}
            onClick={() => send({ action: "execute" })}
          >
            {messages.executeOfficial}
          </Button>
        )}
        {executePrimary && receipts}
        <Button type="button" variant="outline" disabled={pending} onClick={() => send({ action: "pause" })}>{messages.pause}</Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => send({ action: "continue" })}>{messages.continue}</Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => send({ action: "cancel" })}>{messages.cancel}</Button>
      </div>
      {(status || executing) && <p role="status" className="rounded-md border bg-background p-2 text-sm">{status ?? messages.executeOfficialPending}</p>}
      {unknownAttempts.map((attempt) => (
        <form key={attempt.id} className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("actualMinor");
          const actualMinor = value === "" || value === null ? null : Number(value);
          void send({ action: "reconcile", attemptId: attempt.id, actualMinor });
        }}>
          <label className="grid min-w-0 max-w-full gap-1 text-sm">
            <span className="wrap-anywhere">{attempt.questionText}</span>
            <span className="text-muted-foreground">{messages.actualMinor}</span>
            <Input name="actualMinor" inputMode="numeric" />
          </label>
          <Button type="submit" variant="outline" disabled={pending}>{messages.reconcile}</Button>
        </form>
      ))}
      {succeededSlots.length > 0 && (
        <details className="text-sm">
          <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">{messages.redo}</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {succeededSlots.map((slot) => (
              <Button key={slot.id} type="button" variant="outline" disabled={pending} className="h-auto max-w-full wrap-anywhere whitespace-normal py-2 text-left" onClick={() => send({ action: "redo-analysis", slotId: slot.id })}>
                {slot.questionText}
              </Button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

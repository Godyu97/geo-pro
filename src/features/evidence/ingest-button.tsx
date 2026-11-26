"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Messages } from "@/lib/i18n/server";
import { createOperationId } from "@/lib/operation-id";

export function IngestEvidenceButton({
  brandId,
  slotId,
  brandName,
  officialWebsite,
  messages,
}: {
  brandId: string;
  slotId: string;
  brandName: string;
  officialWebsite?: string | null;
  messages: Messages["evidence"];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-1">
      <button
        type="button"
        className="text-sm underline underline-offset-4 disabled:opacity-60"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const response = await fetch("/api/monitoring/answers", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "ingest-adopted",
                brandId,
                slotId,
                operationId: createOperationId(),
                brandName,
                officialWebsite: officialWebsite || null,
                aliases: [],
              }),
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) {
              setError(body?.error?.message ?? messages.SERVICE_UNAVAILABLE);
              return;
            }
            router.push(`/dashboard/monitoring/evidence/${body.observation.id}`);
            router.refresh();
          });
        }}
      >
        {pending ? messages.ingesting : messages.ingest}
      </button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { Messages } from "@/lib/i18n/server";
import { ownershipStates, pageStatuses } from "./contracts";

type Ownership = (typeof ownershipStates)[number];
type PageStatus = (typeof pageStatuses)[number];

const fieldClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function CitationOwnershipForm({
  brandId,
  observationId,
  citationId,
  initialOwnership,
  initialPageStatus,
  messages,
}: {
  brandId: string;
  observationId: string;
  citationId: string;
  initialOwnership: Ownership;
  initialPageStatus: PageStatus;
  messages: Messages["evidence"];
}) {
  const router = useRouter();
  const [ownership, setOwnership] = useState<Ownership>(initialOwnership);
  const [pageStatus, setPageStatus] = useState<PageStatus>(initialPageStatus);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const ownershipId = `citation-ownership-${citationId}`;
  const pageStatusId = `citation-page-status-${citationId}`;

  return (
    <form
      className="min-w-0 space-y-3 border-t pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setSaved(false);
        const currentOpId = operationId;
        start(async () => {
          try {
            const response = await fetch("/api/monitoring/answers", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "update-citation",
                brandId,
                observationId,
                citationId,
                operationId: currentOpId,
                ownership,
                pageStatus,
              }),
            });
            if (!response.ok) {
              const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
              setError(body?.error?.message ?? messages.SERVICE_UNAVAILABLE);
              return;
            }
            setSaved(true);
            setOperationId(crypto.randomUUID());
            router.refresh();
          } catch {
            setError(messages.SERVICE_UNAVAILABLE);
          }
        });
      }}
    >
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <Label htmlFor={ownershipId}>{messages.citationOwnership}</Label>
          <select
            id={ownershipId}
            className={fieldClass}
            value={ownership}
            disabled={pending}
            onChange={(event) => {
              setOwnership(event.target.value as Ownership);
              setOperationId(crypto.randomUUID());
              setSaved(false);
              setError(null);
            }}
          >
            {ownershipStates.map((option) => (
              <option key={option} value={option}>{messages[`ownership_${option}`]}</option>
            ))}
          </select>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor={pageStatusId}>{messages.citationPageStatus}</Label>
          <select
            id={pageStatusId}
            className={fieldClass}
            value={pageStatus}
            disabled={pending}
            onChange={(event) => {
              setPageStatus(event.target.value as PageStatus);
              setOperationId(crypto.randomUUID());
              setSaved(false);
              setError(null);
            }}
          >
            {pageStatuses.map((option) => (
              <option key={option} value={option}>{messages[`pageStatus_${option}`]}</option>
            ))}
          </select>
        </div>
      </div>
      {error && <p role="alert" className="text-sm break-words text-destructive">{error}</p>}
      {saved && <p role="status" className="text-sm break-words">{messages.citationSaved}</p>}
      <Button type="submit" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal text-left" disabled={pending}>
        {pending ? messages.citationSaving : messages.citationSave}
      </Button>
    </form>
  );
}

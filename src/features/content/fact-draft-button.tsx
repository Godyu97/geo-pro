"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function FactDraftButton({
  brandId,
  briefId,
  label,
  pendingLabel,
  readyLabel,
  openLabel,
  fallbackError,
}: {
  brandId: string;
  briefId: string;
  label: string;
  pendingLabel: string;
  readyLabel: string;
  openLabel: string;
  fallbackError: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const response = await fetch("/api/content", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "draft-from-facts",
          brandId,
          briefId,
          operationId: crypto.randomUUID(),
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const message = payload && typeof payload === "object" && "error" in payload
        && payload.error && typeof payload.error === "object" && "message" in payload.error
        && typeof payload.error.message === "string"
        ? payload.error.message
        : null;
      const id = payload && typeof payload === "object" && "version" in payload
        && payload.version && typeof payload.version === "object" && "id" in payload.version
        && typeof payload.version.id === "string"
        ? payload.version.id
        : null;
      if (!response.ok || !id) {
        setError(message ?? fallbackError);
        return;
      }
      setVersionId(id);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-2">
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? pendingLabel : label}
      </Button>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {versionId ? (
        <p className="text-sm">
          {readyLabel}{" "}
          <Link href={`/dashboard/content/versions/${versionId}`} className="underline-offset-4 hover:underline">
            {openLabel}
          </Link>
        </p>
      ) : null}
    </form>
  );
}

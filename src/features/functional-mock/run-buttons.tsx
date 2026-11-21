"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { applyMockContentAction, applyMockEvidenceAction, applyMockPublicationAction, applyMockSamplingQuotaAction } from "./actions";

export function ApplyMockQuotaButton({
  brandId, label, pendingLabel, doneLabel, failedLabel,
}: {
  brandId: string;
  label: string;
  pendingLabel: string;
  doneLabel: string;
  failedLabel: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" disabled={pending} onClick={() => {
        setPending(true);
        setStatus(null);
        void applyMockSamplingQuotaAction(brandId).then((result) => {
          setStatus(result.ok ? doneLabel : failedLabel);
          if (result.ok) router.refresh();
        }).catch(() => setStatus(failedLabel)).finally(() => setPending(false));
      }}>{pending ? pendingLabel : label}</Button>
      {status && <p role="status" className="text-sm">{status}</p>}
    </div>
  );
}

export function ExecuteMockRunButton({
  runId, label, pendingLabel, doneLabel, failedLabel,
}: {
  runId: string;
  label: string;
  pendingLabel: string;
  doneLabel: string;
  failedLabel: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" disabled={pending} onClick={() => {
        setPending(true);
        setStatus(null);
        void fetch(`/api/monitoring/runs/${runId}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "execute-mock" }),
        }).then(async (response) => {
          setStatus(response.ok ? doneLabel : failedLabel);
          if (response.ok) router.refresh();
        }).catch(() => setStatus(failedLabel)).finally(() => setPending(false));
      }}>{pending ? pendingLabel : label}</Button>
      {status && <p role="status" className="text-sm">{status}</p>}
    </div>
  );
}

export function ApplyMockEvidenceButton({
  brandId, label, pendingLabel, doneLabel, failedLabel,
}: {
  brandId: string;
  label: string;
  pendingLabel: string;
  doneLabel: string;
  failedLabel: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" disabled={pending} onClick={() => {
        setPending(true);
        setStatus(null);
        void applyMockEvidenceAction(brandId).then((result) => {
          setStatus(result.ok ? doneLabel : failedLabel);
          if (result.ok) router.refresh();
        }).catch(() => setStatus(failedLabel)).finally(() => setPending(false));
      }}>{pending ? pendingLabel : label}</Button>
      {status && <p role="status" className="text-sm">{status}</p>}
    </div>
  );
}

export function ApplyMockContentButton({
  brandId, label, pendingLabel, doneLabel, failedLabel,
}: {
  brandId: string;
  label: string;
  pendingLabel: string;
  doneLabel: string;
  failedLabel: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" disabled={pending} onClick={() => {
        setPending(true);
        setStatus(null);
        void applyMockContentAction(brandId).then((result) => {
          setStatus(result.ok ? doneLabel : failedLabel);
          if (result.ok) router.refresh();
        }).catch(() => setStatus(failedLabel)).finally(() => setPending(false));
      }}>{pending ? pendingLabel : label}</Button>
      {status && <p role="status" className="text-sm">{status}</p>}
    </div>
  );
}

export function ApplyMockPublicationButton({
  brandId, label, pendingLabel, doneLabel, failedLabel,
}: {
  brandId: string;
  label: string;
  pendingLabel: string;
  doneLabel: string;
  failedLabel: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" disabled={pending} onClick={() => {
        setPending(true);
        setStatus(null);
        void applyMockPublicationAction(brandId).then((result) => {
          setStatus(result.ok ? doneLabel : failedLabel);
          if (result.ok) router.refresh();
        }).catch(() => setStatus(failedLabel)).finally(() => setPending(false));
      }}>{pending ? pendingLabel : label}</Button>
      {status && <p role="status" className="text-sm">{status}</p>}
    </div>
  );
}

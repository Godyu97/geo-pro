"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { applyMockMaterialsAction } from "./actions";

export function ApplyMockMaterialsButton({
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
        void applyMockMaterialsAction(brandId).then((result) => {
          setStatus(result.ok ? doneLabel : failedLabel);
          if (result.ok) router.refresh();
        }).catch(() => setStatus(failedLabel)).finally(() => setPending(false));
      }}>{pending ? pendingLabel : label}</Button>
      {status && <p role="status" className="text-sm">{status}</p>}
    </div>
  );
}

"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function SourceImportSubmit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <>
      <Button type="submit" disabled={pending} className="min-h-10 whitespace-normal">
        {pending ? pendingLabel : label}
      </Button>
      <span role="status" className="sr-only">{pending ? pendingLabel : ""}</span>
    </>
  );
}

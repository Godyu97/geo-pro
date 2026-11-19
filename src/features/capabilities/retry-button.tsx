"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function CapabilityRetryButton({ label }: { label: string }) {
  const router = useRouter();
  const [loading, startTransition] = useTransition();
  return (
    <Button type="button" variant="outline" disabled={loading} onClick={() => startTransition(() => router.refresh())}>
      {label}
    </Button>
  );
}

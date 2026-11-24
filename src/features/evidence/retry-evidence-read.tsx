"use client";

import { Button } from "@/components/ui/button";

export function RetryEvidenceRead({ label }: { label: string }) {
  return <Button type="button" onClick={() => window.location.reload()}>{label}</Button>;
}

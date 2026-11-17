"use client";

import { PageError } from "@/components/layout/page-error";

export default function DashboardError({ reset }: { reset: () => void }) {
  return <PageError reset={reset} embedded />;
}

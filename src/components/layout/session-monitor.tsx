"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";

// This improves recovery only. Every protected server entry must check session
// and ownership independently; the client is never an authorization boundary.
export function SessionMonitor({ userId }: { userId: string }) {
  const { data, error, isPending, isRefetching, refetch } = authClient.useSession();
  const { t } = useLocale();

  useEffect(() => {
    if (isPending) return;
    if ((!data && !error) || error?.status === 401) {
      window.location.replace(loginPath(
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
        "session-required",
      ));
    } else if (data && data.user.id !== userId) {
      // Another tab changed identity: discard the previous user's server UI.
      window.location.reload();
    }
  }, [data, error, isPending, userId]);

  if (!error || error.status === 401) return null;

  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 border-b bg-muted px-4 py-3 text-sm leading-6 sm:px-8">
      <p>{t("sessionCheckFailed")}</p>
      <Button variant="outline" disabled={isRefetching} onClick={() => void refetch()}>
        {t("retry")}
      </Button>
    </div>
  );
}

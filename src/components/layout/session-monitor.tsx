"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { authClient, pendingSignOut } from "@/lib/auth/client";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";

// This improves recovery only. Every protected server entry must check session
// and ownership independently; the client is never an authorization boundary.
export function SessionMonitor({ userId }: { userId: string }) {
  const { data, error, isPending, isRefetching, refetch } = authClient.useSession();
  const { t } = useLocale();

  useEffect(() => {
    function reloadBrandData() {
      const { pathname } = window.location;
      if (pathname !== "/dashboard/settings" && pathname !== "/dashboard/brands" && !pathname.startsWith("/dashboard/brands/")) return;
      // Browser and router history can restore a rendered page past a freeze.
      document.getElementById("main-content")?.setAttribute("hidden", "");
      window.location.reload();
    }
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) reloadBrandData();
    }
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("popstate", reloadBrandData);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("popstate", reloadBrandData);
    };
  }, []);

  useEffect(() => {
    if (isPending) return;
    const expired = (!data && !error) || error?.status === 401;
    const changed = Boolean(data && data.user.id !== userId);
    if (!expired && !changed) return;

    let current = true;
    // A focus or cross-tab check can complete while the sign-out response is in flight.
    void Promise.resolve(pendingSignOut()).then((signedOut) => {
      if (!current || signedOut) return;
      if (expired) {
        window.location.replace(loginPath(
          `${window.location.pathname}${window.location.search}${window.location.hash}`,
          "session-required",
        ));
      } else {
        // Identity changed in another tab. Discard this document's server UI.
        window.location.reload();
      }
    });
    return () => { current = false; };
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

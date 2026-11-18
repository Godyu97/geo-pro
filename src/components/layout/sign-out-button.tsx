"use client";

import { useState } from "react";
import { LoaderCircle, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { safeReturnTo } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";

export function SignOutButton({ returnTo, label }: { returnTo?: string; label?: string } = {}) {
  const { t } = useLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function signOut() {
    setPending(true);
    setError(false);

    try {
      // This document is replaced on success. Suppress the SDK signal so its
      // anonymous-session notification cannot race the explicit sign-out URL.
      const result = await authClient.signOut({ fetchOptions: { disableSignal: true } });
      if (result.error) {
        setError(true);
        return;
      }
      const target = returnTo ? "/login?" + new URLSearchParams({ returnTo: safeReturnTo(returnTo) }) : "/login";
      window.location.replace(target);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {t("signOutFailed")}
        </span>
      )}
      <Button variant="ghost" onClick={signOut} disabled={pending}>
        {pending ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : (
          <LogOut aria-hidden="true" />
        )}
        <span>{label ?? t("signOut")}</span>
      </Button>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isValidationKey, type ValidationKey } from "@/lib/auth/validation";
import type { Messages } from "@/lib/i18n/server";
import { accountAccessPath, emailConfirm, emailOutcomes, emailRequest, type EmailOutcome, type EmailPageMode } from "./contracts";

const responseSchema = z.object({ outcome: z.enum(emailOutcomes) });

function readToken() {
  return new URLSearchParams(window.location.hash.slice(1)).get("token");
}

export function AccountAccessForm({
  mode, returnTo, initialEmail, signedIn, messages: t, authMessages,
}: {
  mode: EmailPageMode;
  returnTo: string;
  initialEmail?: string;
  signedIn: boolean;
  messages: Messages["accountEmail"];
  authMessages: Messages["auth"];
}) {
  const id = useId();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<EmailOutcome | null>(null);
  const [fieldError, setFieldError] = useState<ValidationKey | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const subscribeToFragment = useCallback((update: () => void) => {
    const change = () => {
      setOutcome(null);
      setFieldError(null);
      formRef.current?.reset();
      update();
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const hasFragment = useSyncExternalStore(subscribeToFragment, () => Boolean(readToken()), () => true);
  const requesting = mode === "verify" || mode === "forgot";
  const verifying = mode === "verify" || mode === "confirm";
  const completed = outcome === "verified" || outcome === "passwordUpdated";
  const missingLink = !requesting && !hasFragment && !completed;
  const login = "/login?" + new URLSearchParams({ returnTo });
  const status = missingLink ? "invalidLink" : outcome;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setOutcome(null);
    setFieldError(null);
    const form = event.currentTarget;
    const fields = new FormData(form);
    const token = requesting ? null : readToken();
    const parsed = requesting
      ? emailRequest.safeParse({ action: "request", kind: verifying ? "verify" : "reset", email: fields.get("email"), returnTo })
      : emailConfirm.safeParse(mode === "confirm"
        ? { action: "verify", token }
        : { action: "reset", token, password: fields.get("password") });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      if (isValidationKey(issue?.message)) {
        setFieldError(issue.message);
        const field = form.elements.namedItem(requesting ? "email" : "password");
        if (field instanceof HTMLInputElement) field.focus();
      } else {
        setOutcome(requesting ? "invalidInput" : "invalidLink");
      }
      return;
    }

    setPending(true);
    try {
      const response = await fetch("/api/account-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const result = responseSchema.safeParse(await response.json());
      if (!requesting && readToken() !== token) return;
      const next = result.success ? result.data.outcome : "unavailable";
      setOutcome(next);
      if (next === "verified" || next === "passwordUpdated") {
        form.reset();
        const { pathname, search } = window.location;
        window.history.replaceState(window.history.state, "", pathname + search);
      }
    } catch {
      if (requesting || readToken() === token) setOutcome("unavailable");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      {!completed && !missingLink && (
        <form ref={formRef} method="post" onSubmit={submit} noValidate aria-busy={pending} className="space-y-4"
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
          }}>
          {mode !== "confirm" && (
            <div className="space-y-2">
              <label htmlFor={id} className="block text-sm font-medium">
                {requesting ? authMessages.email : t.newPassword}
              </label>
              <Input id={id} name={requesting ? "email" : "password"} className="h-11"
                type={requesting ? "email" : "password"} autoComplete={requesting ? "email" : "new-password"}
                defaultValue={requesting ? initialEmail : undefined} readOnly={pending || (mode === "verify" && Boolean(initialEmail))}
                maxLength={requesting ? 254 : 128}
                aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? id + "-error" : undefined}
                onChange={() => { setFieldError(null); setOutcome(null); }} />
              {fieldError && <p id={id + "-error"} role="alert" className="text-sm text-destructive">{authMessages[fieldError]}</p>}
            </div>
          )}
          <Button type="submit" className="min-h-11 w-full whitespace-normal" disabled={pending}>
            {pending ? t.pending : requesting ? (outcome === "accepted" ? t.resendLink : t.sendLink)
              : mode === "confirm" ? t.confirm : t.resetPassword}
          </Button>
        </form>
      )}
      {status && <p role="status" className="rounded-lg border bg-muted p-3 text-sm leading-6">{t[status]}</p>}
      {status === "invalidLink" && (
        <Link className="block text-sm underline underline-offset-4" href={accountAccessPath(verifying ? "verify" : "forgot", returnTo)} prefetch={false}>
          {t.resendLink}
        </Link>
      )}
      <Link className="block text-sm underline underline-offset-4" href={signedIn && outcome !== "passwordUpdated" ? returnTo : login} prefetch={false}>
        {signedIn && outcome !== "passwordUpdated" ? t.continue : t.signIn}
      </Link>
    </div>
  );
}

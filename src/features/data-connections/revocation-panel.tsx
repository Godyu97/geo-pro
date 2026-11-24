"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import {
  retainedRowLimit,
  syncAuthorizationErrors,
  type SyncAuthorizationError,
  type SyncAuthorizationView,
} from "./revocation-contracts.ts";

type Copy = Messages["syncAuthorizations"];
type Translator = (key: keyof Copy, params?: Record<string, string | number>) => string;

type Notice = SyncAuthorizationError | "saved" | "revocationSaved" | "pullSaved";

const selectClass = "min-h-10 w-full min-w-0 scroll-mt-20 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal aria-disabled:opacity-50";
const returnPath = "/dashboard/settings/sync-authorizations";

function isSyncError(code: string): code is SyncAuthorizationError {
  return Object.hasOwn(syncAuthorizationErrors, code);
}

function errorFrom(payload: unknown): SyncAuthorizationError {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return "SERVICE_UNAVAILABLE";
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return "SERVICE_UNAVAILABLE";
  return isSyncError(error.code) ? error.code : "SERVICE_UNAVAILABLE";
}

function OperationNotice({ notice, t }: { notice: Notice | null; t: Translator }) {
  return (
    <div role="status">
      {notice ? <p className={isSyncError(notice) ? "text-sm leading-6 text-destructive" : "text-sm leading-6"}>{t(notice)}</p> : null}
    </div>
  );
}

export function SyncAuthorizationsPanel({ brands, authorizations, labels, brandFieldId, messages }: {
  brands: { id: string }[];
  authorizations: SyncAuthorizationView[];
  labels: { brandId: string; name: string }[];
  brandFieldId: string;
  messages: Copy;
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const labelFor = (brandId: string) => labels.find((label) => label.brandId === brandId)?.name ?? brandId;

  return (
    <>
      <section aria-labelledby="sync-authorization-records" className="min-w-0 space-y-3">
        <h2 id="sync-authorization-records" className="text-lg font-semibold">{t("recordsTitle")}</h2>
        {authorizations.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card p-4 text-sm leading-6 text-muted-foreground">{t("empty")}</p>
        ) : authorizations.map((authorization) => (
          <AuthorizationCard key={authorization.id} authorization={authorization} label={labelFor(authorization.brandId)} locale={locale} t={t} />
        ))}
      </section>
      {brands.length > 0 ? <RegisterForm brands={brands} brandFieldId={brandFieldId} labelFor={labelFor} t={t} /> : null}
    </>
  );
}

function RegisterForm({ brands, brandFieldId, labelFor, t }: {
  brands: { id: string }[];
  brandFieldId: string;
  labelFor: (brandId: string) => string;
  t: Translator;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/sync-authorizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: String(data.get("brandId") ?? ""),
          sourceName: String(data.get("sourceName") ?? "").trim(),
          retainedRows: Number(data.get("retainedRows")),
        }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath(returnPath, "session-required"));
          return;
        }
        setNotice(errorFrom(await response.json()));
        return;
      }
      setNotice("saved");
      form.reset();
      router.refresh();
    } catch {
      setNotice("SERVICE_UNAVAILABLE");
    } finally {
      setPending(false);
    }
  }

  function keepComposition(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
  }

  return (
    <form onSubmit={submit} aria-labelledby="sync-authorization-registration" className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
      <h2 id="sync-authorization-registration" className="text-lg font-semibold">{t("register")}</h2>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("brand")}</span>
        <select id={brandFieldId} name="brandId" required className={selectClass} defaultValue={brands[0]?.id}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{labelFor(brand.id)}</option>)}
        </select>
      </label>
      <div className="min-w-0 space-y-1 text-sm">
        <label htmlFor="sync-authorization-source">{t("sourceName")}</label>
        <Input id="sync-authorization-source" name="sourceName" className="min-h-10" required maxLength={80} autoComplete="off"
          aria-describedby="sync-authorization-source-hint" onKeyDown={keepComposition} />
        <p id="sync-authorization-source-hint" className="text-muted-foreground">{t("sourceNameHint")}</p>
      </div>
      <div className="min-w-0 space-y-1 text-sm">
        <label htmlFor="sync-authorization-retained">{t("retainedRows")}</label>
        <Input id="sync-authorization-retained" name="retainedRows" className="min-h-10" type="number"
          required min={0} max={retainedRowLimit} step={1} inputMode="numeric" defaultValue={0}
          aria-describedby="sync-authorization-retained-hint" />
        <p id="sync-authorization-retained-hint" className="text-muted-foreground">{t("retainedRowsHint")}</p>
      </div>
      <Button type="submit" aria-disabled={pending} className={actionClass}>{pending ? t("registering") : t("register")}</Button>
      <OperationNotice notice={notice} t={t} />
    </form>
  );
}

function AuthorizationCard({ authorization, label, locale, t }: {
  authorization: SyncAuthorizationView;
  label: string;
  locale: string;
  t: Translator;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"revoke" | "pull" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const revokedOnClose = useRef(false);
  const titleId = `sync-authorization-${authorization.id}`;
  const [notice, setNotice] = useState<Notice | null>(null);
  const count = new Intl.NumberFormat(locale).format(authorization.retainedRows);
  const formatTime = (value: string) => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));

  async function post(action: "revoke" | "pull") {
    if (pending) return;
    setPending(action);
    setNotice(null);
    try {
      const response = await fetch(`/api/settings/sync-authorizations/${authorization.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath(returnPath, "session-required"));
          return;
        }
        setNotice(errorFrom(await response.json()));
        return;
      }
      setNotice(action === "revoke" ? "revocationSaved" : "pullSaved");
      if (action === "revoke") {
        revokedOnClose.current = true;
        setConfirming(false);
      }
      router.refresh();
    } catch {
      setNotice("SERVICE_UNAVAILABLE");
    } finally {
      setPending(null);
    }
  }

  return (
    <article aria-labelledby={titleId} className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
      <div className="space-y-1">
        <h3 id={titleId} ref={heading} tabIndex={-1}
          className="scroll-mt-20 rounded-sm font-medium [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-ring">
          {authorization.sourceName}
        </h3>
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{label}</p>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="font-medium">{t("status")}</dt>
          <dd><Badge variant={authorization.revoked ? "outline" : "secondary"}>{t(authorization.revoked ? "statusRevoked" : "statusActive")}</Badge></dd>
        </div>
        <div className="min-w-0">
          <dt className="font-medium">{t("retainedRows")}</dt>
          <dd className="tabular-nums">{t("retainedCount", { count })}</dd>
        </div>
      </dl>
      <p id={`${titleId}-pull`} className="text-sm leading-6 text-muted-foreground">{authorization.pull ? t("pullAllowed") : t("pullStopped")}</p>
      <p className="text-sm leading-6 text-muted-foreground">{t("historyKept")}</p>
      <div aria-busy={pending !== null} className="flex flex-wrap gap-2">
        <Button type="button" className={actionClass} aria-disabled={pending !== null}
          aria-describedby={`${titleId}-pull`} onClick={() => void post("pull")}>
          {pending === "pull" ? t("registering") : t("pull")}
        </Button>
        <Dialog open={confirming} onOpenChange={(open) => {
          if (pending) return;
          setNotice(null);
          setConfirming(open);
        }}>
          {!authorization.revoked ? (
            <DialogTrigger asChild>
              <Button type="button" variant="outline" aria-disabled={pending !== null} className={actionClass}>{t("revoke")}</Button>
            </DialogTrigger>
          ) : null}
          <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto" onCloseAutoFocus={(event) => {
            if (!revokedOnClose.current) return;
            event.preventDefault();
            revokedOnClose.current = false;
            heading.current?.focus();
          }}>
            <DialogHeader>
              <DialogTitle>{t("revoke")}</DialogTitle>
              <DialogDescription className="[overflow-wrap:anywhere]">{t("confirmDescription", { source: authorization.sourceName })}</DialogDescription>
            </DialogHeader>
            <OperationNotice notice={confirming ? notice : null} t={t} />
            <DialogFooter className="flex-col">
              <DialogClose asChild>
                <Button type="button" variant="outline" aria-disabled={pending !== null} className={actionClass}>{t("cancel")}</Button>
              </DialogClose>
              <Button type="button" variant="destructive" aria-disabled={pending !== null} className={actionClass} onClick={() => void post("revoke")}>
                {pending === "revoke" ? t("registering") : t("confirmRevoke")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <OperationNotice notice={confirming ? null : notice} t={t} />
      <div className="min-w-0">
        <h4 className="text-sm font-medium">{t("attempts")}</h4>
        {authorization.attempts.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{t("emptyAttempts")}</p> : (
          <ol className="mt-2 space-y-2 text-sm">
            {authorization.attempts.map((attempt) => (
              <li key={attempt.id} className="min-w-0 break-words">
                <span>{attempt.result === "allowed" ? t("resultAllowed") : t("resultStopped")}</span>
                <span className="text-muted-foreground"> · {t("attemptedAt", { time: formatTime(attempt.attemptedAt) })}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </article>
  );
}

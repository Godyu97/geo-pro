"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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

const selectClass = "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm";
const returnPath = "/dashboard/settings/sync-authorizations";

function noticeFrom(payload: unknown, t: Translator) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return t("SERVICE_UNAVAILABLE");
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return t("SERVICE_UNAVAILABLE");
  return error.code in syncAuthorizationErrors ? t(error.code as SyncAuthorizationError) : t("SERVICE_UNAVAILABLE");
}

export function SyncAuthorizationsPanel({ brands, authorizations, labels, messages }: {
  brands: { id: string }[];
  authorizations: SyncAuthorizationView[];
  labels: { brandId: string; name: string }[];
  messages: Copy;
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const labelFor = (brandId: string) => labels.find((label) => label.brandId === brandId)?.name ?? brandId;

  return (
    <div className="space-y-6">
      {brands.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("noBrands")}</p> : (
        <RegisterForm brands={brands} labelFor={labelFor} t={t} />
      )}
      {authorizations.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("empty")}</p> : authorizations.map((authorization) => (
        <AuthorizationCard key={authorization.id} authorization={authorization} label={labelFor(authorization.brandId)} locale={locale} t={t} />
      ))}
    </div>
  );
}

function RegisterForm({ brands, labelFor, t }: {
  brands: { id: string }[];
  labelFor: (brandId: string) => string;
  t: Translator;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const retainedRows = Number(form.get("retainedRows"));
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/sync-authorizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: String(form.get("brandId") ?? ""),
          sourceName: String(form.get("sourceName") ?? "").trim(),
          retainedRows,
        }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath(returnPath, "session-required"));
          return;
        }
        setNotice(noticeFrom(await response.json(), t));
        return;
      }
      setNotice(t("saved"));
      event.currentTarget.reset();
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  function keepComposition(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
  }

  return (
    <form onSubmit={submit} className="min-w-0 space-y-4 rounded-xl border bg-card p-5">
      <h2 className="font-medium">{t("register")}</h2>
      {notice && <p role="status" className="text-sm leading-6">{notice}</p>}
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("brand")}</span>
        <select name="brandId" required className={selectClass} defaultValue={brands[0]?.id}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{labelFor(brand.id)}</option>)}
        </select>
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("sourceName")}</span>
        <Input name="sourceName" required maxLength={80} autoComplete="off" onKeyDown={keepComposition} />
        <span className="block text-muted-foreground">{t("sourceNameHint")}</span>
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("retainedRows")}</span>
        <Input name="retainedRows" type="number" required min={0} max={retainedRowLimit} step={1} inputMode="numeric" defaultValue={0} />
        <span className="block text-muted-foreground">{t("retainedRowsHint")}</span>
      </label>
      <Button type="submit" disabled={pending}>{pending ? t("registering") : t("register")}</Button>
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
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const count = new Intl.NumberFormat(locale).format(authorization.retainedRows);
  const formatTime = (value: string) => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));

  async function post(path: string) {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath(returnPath, "session-required"));
          return;
        }
        setNotice(noticeFrom(await response.json(), t));
        return;
      }
      setNotice(t("saved"));
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="min-w-0 space-y-4 rounded-xl border bg-card p-5">
      <div className="space-y-1">
        <h2 className="break-words font-medium">{authorization.sourceName}</h2>
        <p className="break-words text-sm text-muted-foreground">{label}</p>
      </div>
      {notice && <p role="status" className="text-sm leading-6">{notice}</p>}
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="font-medium">{t("status")}</dt>
          <dd>{authorization.revoked ? t("statusRevoked") : t("statusActive")}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-medium">{t("retainedRows")}</dt>
          <dd className="tabular-nums">{t("retainedCount", { count })}</dd>
        </div>
      </dl>
      <p className="text-sm leading-6 text-muted-foreground">{authorization.pull ? t("pullAllowed") : t("pullStopped")}</p>
      <p className="text-sm leading-6 text-muted-foreground">{t("historyKept")}</p>
      <div className="min-w-0">
        <h3 className="text-sm font-medium">{t("attempts")}</h3>
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
      <div className="flex flex-wrap gap-2">
        {!authorization.revoked && (
          <Button type="button" variant="outline" disabled={pending} onClick={() => void post(`/api/settings/sync-authorizations/${authorization.id}/revoke`)}>
            {t("revoke")}
          </Button>
        )}
        <Button type="button" variant="outline" disabled={pending} onClick={() => void post(`/api/settings/sync-authorizations/${authorization.id}/pull`)}>
          {t("pull")}
        </Button>
      </div>
    </article>
  );
}

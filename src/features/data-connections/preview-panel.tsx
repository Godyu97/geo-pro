"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { dataConnectionErrors, type DataConnectionError, type DataConnectionView } from "./contracts.ts";

type Copy = Messages["dataConnections"];
type Translator = (key: keyof Copy, params?: Record<string, string | number>) => string;

const selectClass = "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm";
const returnPath = "/dashboard/settings/data-connections";

function noticeFrom(payload: unknown, t: Translator) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return t("SERVICE_UNAVAILABLE");
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return t("SERVICE_UNAVAILABLE");
  return error.code in dataConnectionErrors ? t(error.code as DataConnectionError) : t("SERVICE_UNAVAILABLE");
}

function fieldNamesFrom(value: FormDataEntryValue | null) {
  return String(value ?? "").split(/\r?\n/).map((name) => name.trim()).filter((name) => name.length > 0);
}

export function DataConnectionsPanel({ brands, connections, labels, messages }: {
  brands: { id: string }[];
  connections: DataConnectionView[];
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
      {connections.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("emptyConnections")}</p> : connections.map((connection) => (
        <ConnectionCard key={connection.id} connection={connection} label={labelFor(connection.brandId)} locale={locale} t={t} />
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
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/data-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: String(form.get("brandId") ?? ""),
          displayName: String(form.get("displayName") ?? "").trim(),
          fieldNames: fieldNamesFrom(form.get("fieldNames")),
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
        <span>{t("displayName")}</span>
        <Input name="displayName" required maxLength={80} autoComplete="off" onKeyDown={keepComposition} />
        <span className="block text-muted-foreground">{t("displayNameHint")}</span>
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("fieldNames")}</span>
        <textarea
          name="fieldNames"
          required
          rows={4}
          autoComplete="off"
          className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm"
        />
        <span className="block text-muted-foreground">{t("fieldNamesHint")}</span>
      </label>
      <Button type="submit" disabled={pending}>{pending ? t("registering") : t("register")}</Button>
    </form>
  );
}

function ConnectionCard({ connection, label, locale, t }: {
  connection: DataConnectionView;
  label: string;
  locale: string;
  t: Translator;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const count = new Intl.NumberFormat(locale).format(connection.fieldCount);
  const attempted = connection.pullAttemptedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(connection.pullAttemptedAt))
    : t("pullNotRecorded");

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
        <h2 className="break-words font-medium">{connection.displayName}</h2>
        <p className="break-words text-sm text-muted-foreground">{label}</p>
      </div>
      {notice && <p role="status" className="text-sm leading-6">{notice}</p>}
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="font-medium">{t("status")}</dt>
          <dd>{connection.status === "preview" ? t("statusPreview") : t("statusApproved")}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-medium">{t("fieldCountLabel")}</dt>
          <dd className="tabular-nums">{t("fieldCount", { count })}</dd>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className="font-medium">{t("pullAttempt")}</dt>
          <dd className="break-words">{attempted}</dd>
        </div>
      </dl>
      <div className="min-w-0">
        <h3 className="text-sm font-medium">{t("fields")}</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm break-all">
          {connection.fieldNames.map((name) => <li key={`${connection.id}-${name}`}>{name}</li>)}
        </ol>
      </div>
      <div className="flex flex-wrap gap-2">
        {connection.status === "preview" && (
          <Button type="button" variant="outline" disabled={pending} onClick={() => void post(`/api/settings/data-connections/${connection.id}/approve`)}>
            {t("approve")}
          </Button>
        )}
        <Button type="button" variant="outline" disabled={pending} onClick={() => void post(`/api/settings/data-connections/${connection.id}/pull`)}>
          {t("pull")}
        </Button>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{connection.preview.pull ? t("pullAllowed") : t("pullStopped")}</p>
    </article>
  );
}

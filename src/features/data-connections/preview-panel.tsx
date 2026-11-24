"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { dataConnectionErrors, type DataConnectionError, type DataConnectionView } from "./contracts.ts";

type Copy = Messages["dataConnections"];
type Translator = (key: keyof Copy) => string;
type Notice = DataConnectionError | "saved" | "approvalSaved" | "pullSaved";

const fieldClass = "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal aria-disabled:opacity-50";
const returnPath = "/dashboard/settings/data-connections";

function isDataConnectionError(code: string): code is DataConnectionError {
  return Object.hasOwn(dataConnectionErrors, code);
}

function errorFrom(payload: unknown): DataConnectionError {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return "SERVICE_UNAVAILABLE";
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return "SERVICE_UNAVAILABLE";
  return isDataConnectionError(error.code) ? error.code : "SERVICE_UNAVAILABLE";
}

function fieldNamesFrom(value: FormDataEntryValue | null) {
  return String(value ?? "").split(/\r?\n/).map((name) => name.trim()).filter((name) => name.length > 0);
}

function OperationNotice({ notice, t }: { notice: Notice | null; t: Translator }) {
  return (
    <div role="status">
      {notice ? <p className={isDataConnectionError(notice) ? "text-sm leading-6 text-destructive" : "text-sm leading-6"}>{t(notice)}</p> : null}
    </div>
  );
}

export function DataConnectionsPanel({ brands, connections, labels, brandFieldId, messages }: {
  brands: { id: string }[];
  connections: DataConnectionView[];
  labels: { brandId: string; name: string }[];
  brandFieldId: string;
  messages: Copy;
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const labelFor = (brandId: string) => labels.find((label) => label.brandId === brandId)?.name ?? brandId;

  return (
    <>
      <section aria-labelledby="data-connection-records" className="min-w-0 space-y-3">
        <h2 id="data-connection-records" className="text-lg font-semibold">{t("recordsTitle")}</h2>
        {connections.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card p-4 text-sm leading-6 text-muted-foreground">{t("emptyConnections")}</p>
        ) : connections.map((connection) => (
          <ConnectionCard key={connection.id} connection={connection} label={labelFor(connection.brandId)} locale={locale} t={t} />
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
      const response = await fetch("/api/settings/data-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: String(data.get("brandId") ?? ""),
          displayName: String(data.get("displayName") ?? "").trim(),
          fieldNames: fieldNamesFrom(data.get("fieldNames")),
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
      form.reset();
      setNotice("saved");
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
    <form onSubmit={submit} aria-labelledby="data-connection-registration" className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
      <h2 id="data-connection-registration" className="text-lg font-semibold">{t("register")}</h2>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("brand")}</span>
        <select id={brandFieldId} name="brandId" required className={`${fieldClass} min-h-10 scroll-mt-20`} defaultValue={brands[0]?.id}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{labelFor(brand.id)}</option>)}
        </select>
      </label>
      <div className="min-w-0 space-y-1 text-sm">
        <label htmlFor="data-connection-name">{t("displayName")}</label>
        <Input id="data-connection-name" name="displayName" className="min-h-10" required maxLength={80} autoComplete="off"
          aria-describedby="data-connection-name-hint" onKeyDown={keepComposition} />
        <p id="data-connection-name-hint" className="text-muted-foreground">{t("displayNameHint")}</p>
      </div>
      <div className="min-w-0 space-y-1 text-sm">
        <label htmlFor="data-connection-fields">{t("fieldNames")}</label>
        <textarea
          id="data-connection-fields"
          name="fieldNames"
          required
          rows={4}
          autoComplete="off"
          spellCheck={false}
          aria-describedby="data-connection-fields-hint"
          className={`${fieldClass} block py-2`}
        />
        <p id="data-connection-fields-hint" className="text-muted-foreground">{t("fieldNamesHint")}</p>
      </div>
      <Button type="submit" aria-disabled={pending} className={actionClass}>{pending ? t("registering") : t("register")}</Button>
      <OperationNotice notice={notice} t={t} />
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
  const [notice, setNotice] = useState<Notice | null>(null);
  const titleId = `connection-${connection.id}`;
  const heading = useRef<HTMLHeadingElement>(null);
  const needsApproval = connection.status === "preview";
  const count = new Intl.NumberFormat(locale).format(connection.fieldCount);
  const attempted = connection.pullAttemptedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(connection.pullAttemptedAt))
    : t("pullNotRecorded");

  async function post(action: "approve" | "pull", trigger: HTMLButtonElement) {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/settings/data-connections/${connection.id}/${action}`, {
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
      setNotice(action === "approve" ? "approvalSaved" : "pullSaved");
      if (action === "approve" && document.activeElement === trigger) heading.current?.focus();
      router.refresh();
    } catch {
      setNotice("SERVICE_UNAVAILABLE");
    } finally {
      setPending(false);
    }
  }

  return (
    <article aria-labelledby={titleId} className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
      <div className="space-y-1">
        <h3 id={titleId} ref={heading} tabIndex={-1}
          className="scroll-mt-20 rounded-sm font-medium [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-ring">
          {connection.displayName}
        </h3>
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{label}</p>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="font-medium">{t("status")}</dt>
          <dd><Badge variant={needsApproval ? "outline" : "secondary"}>{t(needsApproval ? "statusPreview" : "statusApproved")}</Badge></dd>
        </div>
        <div className="min-w-0">
          <dt className="font-medium">{t("fieldCountLabel")}</dt>
          <dd className="tabular-nums">{count}</dd>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className="font-medium">{t("pullAttempt")}</dt>
          <dd className="tabular-nums [overflow-wrap:anywhere]">{attempted}</dd>
        </div>
      </dl>
      <div className="min-w-0">
        <h4 className="text-sm font-medium">{t("fields")}</h4>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm [overflow-wrap:anywhere]">
          {connection.fieldNames.map((name) => <li key={`${connection.id}-${name}`}>{name}</li>)}
        </ol>
      </div>
      <p id={`${titleId}-pull`} className="text-sm leading-6 text-muted-foreground">
        {t(connection.preview.pull ? "pullAllowed" : "pullStopped")}
      </p>
      <div aria-busy={pending} className="flex flex-wrap gap-2">
        {needsApproval && (
          <Button type="button" className={actionClass} aria-disabled={pending} onClick={(event) => void post("approve", event.currentTarget)}>
            {t("approve")}
          </Button>
        )}
        <Button type="button" variant={needsApproval ? "outline" : "default"} className={actionClass} aria-disabled={pending}
          aria-describedby={`${titleId}-pull`} onClick={(event) => void post("pull", event.currentTarget)}>
          {t("pull")}
        </Button>
      </div>
      <OperationNotice notice={notice} t={t} />
    </article>
  );
}

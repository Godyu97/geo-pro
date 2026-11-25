"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import type { DataConnectionView } from "./contracts.ts";
import {
  connectorEventErrors,
  parseConnectorEventLines,
  type ConnectorEventError,
  type ConnectorEventView,
} from "./event-contracts.ts";

type Copy = Messages["connectorEvents"];
type Translator = (key: keyof Copy, params?: Record<string, string | number>) => string;

const fieldClass = "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";
const returnPath = "/dashboard/reports/connector-events";

function isConnectorEventError(code: string): code is ConnectorEventError {
  return Object.hasOwn(connectorEventErrors, code);
}

function errorFrom(payload: unknown): ConnectorEventError {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return "SERVICE_UNAVAILABLE";
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return "SERVICE_UNAVAILABLE";
  return isConnectorEventError(error.code) ? error.code : "SERVICE_UNAVAILABLE";
}

function sourceLabel(source: ConnectorEventView["sources"][number]["source"], t: Translator) {
  return source === "csv" ? t("sourceCsv") : t("sourceConnector");
}

export function ConnectorEventsPanel({ brands, events, connections, labels, messages, rowsFieldId }: {
  brands: { id: string }[];
  events: ConnectorEventView[];
  connections: DataConnectionView[];
  labels: { brandId: string; name: string }[];
  messages: Copy;
  rowsFieldId: string;
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const names = new Map(labels.map(({ brandId, name }) => [brandId, name]));
  const labelFor = (brandId: string) => names.get(brandId) ?? brandId;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

  const syncRows = connections.length > 0 ? connections : [null];

  return (
    <>
      {brands.length > 0 ? <ImportForm brands={brands} labelFor={labelFor} rowsFieldId={rowsFieldId} t={t} /> : null}
      <section aria-labelledby="connector-sync" className="min-w-0 space-y-3">
        <h2 id="connector-sync" className="text-lg font-semibold">{t("syncHeading")}</h2>
        {syncRows.map((connection) => (
          <article key={connection?.id ?? "sync-empty"} className="min-w-0 space-y-2 rounded-xl border bg-card p-4 text-sm leading-6">
            {connection ? <h3 className="font-medium [overflow-wrap:anywhere]">{connection.displayName}</h3> : null}
            <p className="[overflow-wrap:anywhere]">{connection?.syncCursor ?? t("syncCursorEmpty")}</p>
            {connection?.coverageComplete === false ? <p>{t("coverageIncomplete")}</p> : null}
            {connection?.syncStopped ? <p>{t("syncStoppedNotice")}</p> : null}
            <p className="font-medium">{t("sourcesHeading")}</p>
            <p className="[overflow-wrap:anywhere]">
              {!connection || connection.sources.length === 0
                ? t("sourcesEmpty")
                : connection.sources.map((source) => sourceLabel(source.source, t)).join(" · ")}
            </p>
          </article>
        ))}
      </section>
      <section aria-labelledby="connector-event-records" className="min-w-0 space-y-3">
        <h2 id="connector-event-records" className="text-lg font-semibold">{t("recordsTitle")}</h2>
        {events.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card p-4 text-sm leading-6 text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="space-y-3">
            {events.map((event) => (
              <li key={event.id} className="min-w-0 space-y-2 rounded-xl border bg-card p-4">
                <p className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">{labelFor(event.brandId)}</p>
                <h3 className="font-medium [overflow-wrap:anywhere]">{event.eventKey}</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm tabular-nums">{t("count", { count: event.count })}</p>
                  <Badge variant={event.conflict ? "destructive" : "secondary"}>{t(event.conflict ? "conflict" : "consistent")}</Badge>
                </div>
                <ul className="space-y-1 text-sm leading-6">
                  {event.sources.map((source) => (
                    <li key={source.source} className="[overflow-wrap:anywhere]">
                      {sourceLabel(source.source, t)} · {source.payloadDigest}
                    </li>
                  ))}
                </ul>
                <p className="text-sm leading-6 text-muted-foreground">{t("notIndexed")}</p>
                <p className="text-sm leading-6 text-muted-foreground tabular-nums">{t("updatedAt", { time: when.format(new Date(event.updatedAt)) })}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function ImportForm({ brands, labelFor, rowsFieldId, t }: {
  brands: { id: string }[];
  labelFor: (brandId: string) => string;
  rowsFieldId: string;
  t: Translator;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<ConnectorEventError | "saved" | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = parseConnectorEventLines(String(data.get("lines") ?? ""));
    if ("error" in parsed) {
      setNotice("INVALID_INPUT");
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/reports/connector-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: String(data.get("brandId") ?? ""), rows: parsed.rows }),
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

  function keepComposition(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
  }

  return (
    <form onSubmit={submit} aria-labelledby="connector-event-import" className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
      <h2 id="connector-event-import" className="text-lg font-semibold">{t("importTitle")}</h2>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("brand")}</span>
        <select name="brandId" required className={`${fieldClass} min-h-10`} defaultValue={brands[0]?.id}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{labelFor(brand.id)}</option>)}
        </select>
      </label>
      <div className="min-w-0 space-y-1 text-sm">
        <label htmlFor={rowsFieldId}>{t("lines")}</label>
        <textarea
          id={rowsFieldId}
          name="lines"
          required
          rows={4}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={notice === "INVALID_INPUT" ? "connector-event-hint connector-event-notice" : "connector-event-hint"}
          aria-invalid={notice === "INVALID_INPUT" || undefined}
          onKeyDown={keepComposition}
          className={`${fieldClass} block scroll-mt-20 py-2 aria-invalid:border-destructive`}
        />
        <p id="connector-event-hint" className="text-muted-foreground">{t("linesHint")}</p>
      </div>
      <div className="space-y-2">
        <Button type="submit" aria-disabled={pending} className="h-auto min-h-10 max-w-full py-2 whitespace-normal aria-disabled:opacity-50">
          {pending ? t("importing") : t("importAction")}
        </Button>
        <div id="connector-event-notice" role="status">
          {notice ? <p className={notice === "saved" ? "text-sm leading-6" : "text-sm leading-6 text-destructive"}>{t(notice)}</p> : null}
        </div>
      </div>
    </form>
  );
}

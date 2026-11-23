"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import {
  connectorEventErrors,
  parseConnectorEventLines,
  type ConnectorEventError,
  type ConnectorEventView,
} from "./event-contracts.ts";

type Copy = Messages["connectorEvents"];
type Translator = (key: keyof Copy, params?: Record<string, string | number>) => string;

const selectClass = "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm";
const returnPath = "/dashboard/reports/connector-events";

function isConnectorEventError(code: string): code is ConnectorEventError {
  return Object.hasOwn(connectorEventErrors, code);
}

function noticeFrom(payload: unknown, t: Translator) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return t("SERVICE_UNAVAILABLE");
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return t("SERVICE_UNAVAILABLE");
  return isConnectorEventError(error.code) ? t(error.code) : t("SERVICE_UNAVAILABLE");
}

function sourceLabel(source: ConnectorEventView["sources"][number]["source"], t: Translator) {
  return source === "csv" ? t("sourceCsv") : t("sourceConnector");
}

export function ConnectorEventsPanel({ brands, events, labels, messages }: {
  brands: { id: string }[];
  events: ConnectorEventView[];
  labels: { brandId: string; name: string }[];
  messages: Copy;
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const labelFor = (brandId: string) => labels.find((label) => label.brandId === brandId)?.name ?? brandId;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

  return (
    <div className="space-y-6">
      {brands.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("noBrands")}</p> : (
        <ImportForm brands={brands} labelFor={labelFor} t={t} />
      )}
      {events.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("empty")}</p> : (
        <ul className="space-y-3">
          {events.map((event) => (
            <li key={event.id} className="min-w-0 space-y-2 rounded-xl border bg-card p-5">
              <p className="break-all font-medium">{event.eventKey}</p>
              <p className="text-sm leading-6 text-muted-foreground">{t("count", { count: event.count })}</p>
              <p className="text-sm leading-6">{event.conflict ? t("conflict") : t("consistent")}</p>
              <p className="text-sm leading-6 text-muted-foreground">{t("notIndexed")}</p>
              <ul className="space-y-1 text-sm leading-6">
                {event.sources.map((source) => (
                  <li key={source.source} className="break-all">
                    {sourceLabel(source.source, t)} · {source.payloadDigest}
                  </li>
                ))}
              </ul>
              <p className="text-sm leading-6 text-muted-foreground">{t("updatedAt", { time: when.format(new Date(event.updatedAt)) })}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ImportForm({ brands, labelFor, t }: {
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
    const parsed = parseConnectorEventLines(String(form.get("lines") ?? ""));
    if ("error" in parsed) {
      setNotice(t("INVALID_INPUT"));
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/reports/connector-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: String(form.get("brandId") ?? ""), rows: parsed.rows }),
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

  function keepComposition(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
  }

  return (
    <form onSubmit={submit} className="min-w-0 space-y-4 rounded-xl border bg-card p-5">
      <h2 className="font-medium">{t("importTitle")}</h2>
      {notice && <p role="status" className="text-sm leading-6">{notice}</p>}
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("brand")}</span>
        <select name="brandId" required className={selectClass} defaultValue={brands[0]?.id}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{labelFor(brand.id)}</option>)}
        </select>
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("lines")}</span>
        <textarea
          name="lines"
          required
          rows={4}
          autoComplete="off"
          spellCheck={false}
          onKeyDown={keepComposition}
          className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm"
        />
        <span className="block text-muted-foreground">{t("linesHint")}</span>
      </label>
      <Button type="submit" disabled={pending}>{pending ? t("importing") : t("importAction")}</Button>
    </form>
  );
}

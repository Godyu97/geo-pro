"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import {
  createSamplingProtocolSchema,
  freezeSamplingProtocolSchema,
  pinSamplingProtocolSchema,
  samplingProtocolErrors,
  type SamplingProtocolError,
  type SamplingProtocolPinView,
  type SamplingProtocolStatus,
  type SamplingProtocolView,
} from "./protocol-contracts.ts";

type Copy = Messages["samplingProtocols"];
type Translator = (key: keyof Copy, params?: Record<string, string | number>) => string;

const fieldClass = "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm";
const returnPath = "/dashboard/monitoring/protocols";

const statusKey: Record<SamplingProtocolStatus, keyof Copy> = {
  draft: "statusDraft",
  frozen: "statusFrozen",
};

function isProtocolError(code: string): code is SamplingProtocolError {
  return Object.hasOwn(samplingProtocolErrors, code);
}

function noticeFrom(payload: unknown, t: Translator) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return t("SERVICE_UNAVAILABLE");
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return t("SERVICE_UNAVAILABLE");
  return isProtocolError(error.code) ? t(error.code) : t("SERVICE_UNAVAILABLE");
}

function familiesOf(protocols: readonly SamplingProtocolView[]) {
  const families = new Map<string, SamplingProtocolView[]>();
  for (const protocol of protocols) {
    const rows = families.get(protocol.protocolId) ?? [];
    rows.push(protocol);
    families.set(protocol.protocolId, rows);
  }
  return [...families.values()];
}

export function ProtocolsPanel({ brands, protocols, pins, labels, messages }: {
  brands: { id: string }[];
  protocols: SamplingProtocolView[];
  pins: SamplingProtocolPinView[];
  labels: { brandId: string; name: string }[];
  messages: Copy;
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const labelFor = (brandId: string) => labels.find((label) => label.brandId === brandId)?.name ?? brandId;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const families = familiesOf(protocols);

  return (
    <div className="space-y-6">
      {brands.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("noBrands")}</p> : (
        <CreateForm brands={brands} labelFor={labelFor} t={t} />
      )}
      {families.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("empty")}</p> : (
        <ul className="space-y-3">
          {families.map((versions) => {
            const ordered = [...versions].sort((left, right) => left.version - right.version);
            const latest = ordered[ordered.length - 1];
            if (!latest) return null;
            return (
              <li key={latest.protocolId} className="min-w-0 space-y-3 rounded-xl border bg-card p-5">
                <p className="break-words text-sm leading-6 text-muted-foreground">{labelFor(latest.brandId)}</p>
                <ul className="space-y-3">
                  {ordered.map((protocol) => (
                    <li key={protocol.id} className="min-w-0 space-y-1">
                      <p className="text-sm leading-6">{t("versionLine", { version: protocol.version })}</p>
                      <p className="text-sm leading-6">{t("statusLine", { status: t(statusKey[protocol.status]) })}</p>
                      <p className="break-words text-sm leading-6">{t("regionLine", { region: protocol.targetRegion })}</p>
                      <p className="break-words text-sm leading-6">{t("timezoneLine", { timezone: protocol.timezone })}</p>
                      <p className="text-sm leading-6">{protocol.newSessionRequired ? t("sessionOn") : t("sessionOff")}</p>
                      <p className="text-sm leading-6">{protocol.searchRequired ? t("searchOn") : t("searchOff")}</p>
                      <p className="text-sm leading-6 text-muted-foreground">{t("createdAt", { time: when.format(new Date(protocol.createdAt)) })}</p>
                      {protocol.status === "frozen" ? <PinForm protocol={protocol} pins={pins} t={t} /> : null}
                    </li>
                  ))}
                </ul>
                <FreezeForm protocol={latest} t={t} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CreateForm({ brands, labelFor, t }: {
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
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = createSamplingProtocolSchema.safeParse({
      operationId: crypto.randomUUID(),
      brandId: String(data.get("brandId") ?? ""),
      newSessionRequired: data.get("newSessionRequired") === "on",
      searchRequired: data.get("searchRequired") === "on",
      targetRegion: String(data.get("targetRegion") ?? ""),
      timezone: String(data.get("timezone") ?? ""),
    });
    if (!parsed.success) {
      setNotice(t("INVALID_INPUT"));
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/monitoring/protocols", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
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
      form.reset();
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="min-w-0 space-y-4 rounded-xl border bg-card p-5">
      <h2 className="font-medium">{t("registerTitle")}</h2>
      {notice && <p role="status" className="text-sm leading-6">{notice}</p>}
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("brand")}</span>
        <select name="brandId" required className={fieldClass} defaultValue={brands[0]?.id}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{labelFor(brand.id)}</option>)}
        </select>
      </label>
      <label className="flex min-w-0 items-start gap-2 text-sm leading-6">
        <input name="newSessionRequired" type="checkbox" className="mt-1" defaultChecked />
        <span>{t("newSession")}</span>
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span className="flex items-start gap-2">
          <input name="searchRequired" type="checkbox" className="mt-1" />
          <span>{t("searchRequired")}</span>
        </span>
        <span className="block text-muted-foreground">{t("searchHint")}</span>
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("targetRegion")}</span>
        <input name="targetRegion" type="text" required maxLength={2} autoComplete="off" className={fieldClass} defaultValue="CN" />
        <span className="block text-muted-foreground">{t("targetRegionHint")}</span>
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("timezone")}</span>
        <input name="timezone" type="text" required maxLength={64} autoComplete="off" className={fieldClass} defaultValue="Asia/Shanghai" />
        <span className="block text-muted-foreground">{t("timezoneHint")}</span>
      </label>
      <Button type="submit" disabled={pending}>{pending ? t("registering") : t("registerAction")}</Button>
    </form>
  );
}

function FreezeForm({ protocol, t }: { protocol: SamplingProtocolView; t: Translator }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const parsed = freezeSamplingProtocolSchema.safeParse({
      operationId: crypto.randomUUID(),
      newSessionRequired: data.get("newSessionRequired") === "on",
      searchRequired: data.get("searchRequired") === "on",
      targetRegion: String(data.get("targetRegion") ?? ""),
      timezone: String(data.get("timezone") ?? ""),
    });
    if (!parsed.success) {
      setNotice(t("INVALID_INPUT"));
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/monitoring/protocols/${protocol.protocolId}/freeze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath(returnPath, "session-required"));
          return;
        }
        setNotice(noticeFrom(await response.json(), t));
        return;
      }
      setNotice(t("frozenSaved"));
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form key={`${protocol.id}:${protocol.version}:${protocol.status}`} onSubmit={submit} className="min-w-0 space-y-3 border-t pt-3">
      <h2 className="font-medium">{t("freezeTitle")}</h2>
      {notice && <p role="status" className="text-sm leading-6">{notice}</p>}
      <label className="flex min-w-0 items-start gap-2 text-sm leading-6">
        <input name="newSessionRequired" type="checkbox" className="mt-1" defaultChecked={protocol.newSessionRequired} />
        <span>{t("newSession")}</span>
      </label>
      <label className="flex min-w-0 items-start gap-2 text-sm leading-6">
        <input name="searchRequired" type="checkbox" className="mt-1" defaultChecked={protocol.searchRequired} />
        <span>{t("searchRequired")}</span>
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("targetRegion")}</span>
        <input name="targetRegion" type="text" required maxLength={2} autoComplete="off" className={fieldClass} defaultValue={protocol.targetRegion} />
      </label>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("timezone")}</span>
        <input name="timezone" type="text" required maxLength={64} autoComplete="off" className={fieldClass} defaultValue={protocol.timezone} />
      </label>
      <Button type="submit" disabled={pending}>{pending ? t("freezing") : t("freezeAction")}</Button>
    </form>
  );
}

function PinForm({ protocol, pins, t }: {
  protocol: SamplingProtocolView;
  pins: SamplingProtocolPinView[];
  t: Translator;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const matched = pins.filter((pin) => pin.protocolId === protocol.protocolId && pin.version === protocol.version);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const runId = String(data.get("runId") ?? "");
    const parsed = pinSamplingProtocolSchema.safeParse({ protocolId: protocol.protocolId, version: protocol.version });
    if (!parsed.success) {
      setNotice(t("INVALID_INPUT"));
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/monitoring/runs/${runId}/protocol`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath(returnPath, "session-required"));
          return;
        }
        setNotice(noticeFrom(await response.json(), t));
        return;
      }
      setNotice(t("pinned"));
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="min-w-0 space-y-2">
      <h3 className="text-sm font-medium">{t("pinTitle")}</h3>
      {notice && <p role="status" className="text-sm leading-6">{notice}</p>}
      {matched.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("pinEmpty")}</p> : (
        <ul className="space-y-1">
          {matched.map((pin) => (
            <li key={pin.runId} className="break-all text-sm leading-6">{t("pinLine", { runId: pin.runId, version: pin.version })}</li>
          ))}
        </ul>
      )}
      <label className="block min-w-0 space-y-1 text-sm">
        <span>{t("runId")}</span>
        <input name="runId" type="text" required maxLength={36} autoComplete="off" className={fieldClass} />
      </label>
      <Button type="submit" disabled={pending}>{pending ? t("pinning") : t("pinAction")}</Button>
    </form>
  );
}

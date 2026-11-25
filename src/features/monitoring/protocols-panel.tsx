"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { brandIdSchema } from "../brands/contracts.ts";
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
type Notice = { kind: "status" | "alert"; text: string };

const selectClass = "h-10 w-full min-w-0 scroll-mt-24 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const inputClass = "h-10 bg-background";
const actionClass = "min-h-10 whitespace-normal justify-self-start text-center aria-disabled:opacity-60";
const returnPath = "/dashboard/monitoring/protocols";

const statusKey: Record<SamplingProtocolStatus, keyof Copy> = {
  draft: "statusDraft",
  frozen: "statusFrozen",
};

function isProtocolError(code: string): code is SamplingProtocolError {
  return Object.hasOwn(samplingProtocolErrors, code);
}

function noticeFrom(payload: unknown, t: Translator): Notice {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return { kind: "alert", text: t("SERVICE_UNAVAILABLE") };
  }
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") {
    return { kind: "alert", text: t("SERVICE_UNAVAILABLE") };
  }
  return { kind: "alert", text: isProtocolError(error.code) ? t(error.code) : t("SERVICE_UNAVAILABLE") };
}

function NoticeBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <p
      role={notice.kind}
      className={notice.kind === "alert"
        ? "rounded-lg border border-destructive/30 bg-card p-3 text-sm leading-6 text-destructive"
        : "rounded-lg border bg-card p-3 text-sm leading-6"}
    >
      {notice.text}
    </p>
  );
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
    <div className="min-w-0 space-y-6">
      {brands.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground">{t("noBrands")}</p>
      ) : (
        <CreateForm brands={brands} labelFor={labelFor} t={t} />
      )}

      <section aria-labelledby="protocol-families" className="space-y-4">
        <h2
          id="protocol-families"
          tabIndex={-1}
          className="scroll-mt-24 rounded-sm text-lg font-semibold focus-visible:outline-2 focus-visible:outline-ring"
        >
          {t("familiesHeading")}
        </h2>
        {families.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="space-y-4">
            {families.map((versions) => {
              const ordered = [...versions].sort((left, right) => left.version - right.version);
              const latest = ordered[ordered.length - 1];
              if (!latest) return null;
              return (
                <li key={latest.protocolId}>
                  <Card size="sm" className="min-w-0">
                    <CardContent className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-semibold [overflow-wrap:anywhere]">{labelFor(latest.brandId)}</h3>
                        <Badge variant={latest.status === "frozen" ? "default" : "secondary"}>
                          {t("statusLine", { status: t(statusKey[latest.status]) })}
                        </Badge>
                      </div>
                      <ul className="space-y-3">
                        {ordered.map((protocol) => (
                          <li key={protocol.id} className="min-w-0 space-y-3 rounded-xl border bg-muted/30 p-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">{t("versionLine", { version: protocol.version })}</Badge>
                              <Badge variant={protocol.status === "frozen" ? "default" : "secondary"}>
                                {t(statusKey[protocol.status])}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {t("createdAt", { time: when.format(new Date(protocol.createdAt)) })}
                              </span>
                            </div>
                            <dl className="grid gap-2 text-sm leading-6 sm:grid-cols-2">
                              <div className="min-w-0">
                                <dt className="text-xs text-muted-foreground">{t("targetRegion")}</dt>
                                <dd className="[overflow-wrap:anywhere]">{t("regionLine", { region: protocol.targetRegion })}</dd>
                              </div>
                              <div className="min-w-0">
                                <dt className="text-xs text-muted-foreground">{t("timezone")}</dt>
                                <dd className="[overflow-wrap:anywhere]">{t("timezoneLine", { timezone: protocol.timezone })}</dd>
                              </div>
                              <div className="min-w-0">
                                <dt className="text-xs text-muted-foreground">{t("newSession")}</dt>
                                <dd>{protocol.newSessionRequired ? t("sessionOn") : t("sessionOff")}</dd>
                              </div>
                              <div className="min-w-0">
                                <dt className="text-xs text-muted-foreground">{t("searchRequired")}</dt>
                                <dd>{protocol.searchRequired ? t("searchOn") : t("searchOff")}</dd>
                              </div>
                            </dl>
                            {protocol.status === "frozen" ? <PinForm protocol={protocol} pins={pins} t={t} /> : null}
                          </li>
                        ))}
                      </ul>
                      <FreezeForm protocol={latest} t={t} />
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
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
  const [notice, setNotice] = useState<Notice | null>(null);

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
      setNotice({ kind: "alert", text: t("INVALID_INPUT") });
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
      setNotice({ kind: "status", text: t("saved") });
      form.reset();
      router.refresh();
    } catch {
      setNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardContent>
        <form onSubmit={submit} className="grid min-w-0 gap-4">
          <h2 className="text-base font-semibold">{t("registerTitle")}</h2>
          <NoticeBanner notice={notice} />
          <div className="space-y-1.5">
            <Label htmlFor="protocol-brand">{t("brand")}</Label>
            <select id="protocol-brand" name="brandId" required disabled={pending} className={selectClass} defaultValue={brands[0]?.id}>
              {brands.map((brand) => <option key={brand.id} value={brand.id}>{labelFor(brand.id)}</option>)}
            </select>
          </div>
          <label className="flex min-w-0 items-start gap-2 text-sm leading-6">
            <input name="newSessionRequired" type="checkbox" className="mt-1" defaultChecked onClick={(event) => { if (pending) event.preventDefault(); }} />
            <span>{t("newSession")}</span>
          </label>
          <div className="space-y-1 text-sm">
            <label className="flex min-w-0 items-start gap-2 leading-6">
              <input name="searchRequired" type="checkbox" className="mt-1" onClick={(event) => { if (pending) event.preventDefault(); }} />
              <span>{t("searchRequired")}</span>
            </label>
            <p className="text-muted-foreground">{t("searchHint")}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="protocol-region">{t("targetRegion")}</Label>
              <Input
                id="protocol-region"
                name="targetRegion"
                type="text"
                required
                pattern="[A-Z]{2}"
                maxLength={2}
                autoComplete="off"
                spellCheck={false}
                readOnly={pending}
                aria-describedby="protocol-region-hint"
                className={inputClass}
                defaultValue="CN"
              />
              <p id="protocol-region-hint" className="text-xs text-muted-foreground">{t("targetRegionHint")}</p>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="protocol-timezone">{t("timezone")}</Label>
              <Input
                id="protocol-timezone"
                name="timezone"
                type="text"
                required
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
                readOnly={pending}
                aria-describedby="protocol-timezone-hint"
                className={inputClass}
                defaultValue="Asia/Shanghai"
              />
              <p id="protocol-timezone-hint" className="text-xs text-muted-foreground">{t("timezoneHint")}</p>
            </div>
          </div>
          <Button type="submit" aria-disabled={pending} className={actionClass}>
            {pending ? t("registering") : t("registerAction")}
          </Button>
          <p role="status" className="sr-only">{pending ? t("registering") : ""}</p>
        </form>
      </CardContent>
    </Card>
  );
}

function FreezeForm({ protocol, t }: { protocol: SamplingProtocolView; t: Translator }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

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
      setNotice({ kind: "alert", text: t("INVALID_INPUT") });
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
      setNotice({ kind: "status", text: t("frozenSaved") });
      router.refresh();
    } catch {
      setNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
    } finally {
      setPending(false);
    }
  }

  return (
    <form key={`${protocol.id}:${protocol.version}:${protocol.status}`} onSubmit={submit} className="grid min-w-0 gap-3 border-t pt-4">
      <h4 className="font-medium">{t("freezeTitle")}</h4>
      <NoticeBanner notice={notice} />
      <label className="flex min-w-0 items-start gap-2 text-sm leading-6">
        <input name="newSessionRequired" type="checkbox" className="mt-1" defaultChecked={protocol.newSessionRequired} onClick={(event) => { if (pending) event.preventDefault(); }} />
        <span>{t("newSession")}</span>
      </label>
      <label className="flex min-w-0 items-start gap-2 text-sm leading-6">
        <input name="searchRequired" type="checkbox" className="mt-1" defaultChecked={protocol.searchRequired} onClick={(event) => { if (pending) event.preventDefault(); }} />
        <span>{t("searchRequired")}</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="min-w-0 space-y-1.5 text-sm">
          <span className="font-medium">{t("targetRegion")}</span>
          <Input name="targetRegion" type="text" required pattern="[A-Z]{2}" maxLength={2} autoComplete="off" spellCheck={false}
            readOnly={pending} className={inputClass} defaultValue={protocol.targetRegion} />
        </label>
        <label className="min-w-0 space-y-1.5 text-sm">
          <span className="font-medium">{t("timezone")}</span>
          <Input name="timezone" type="text" required maxLength={64} autoComplete="off" spellCheck={false}
            readOnly={pending} className={inputClass} defaultValue={protocol.timezone} />
        </label>
      </div>
      <Button type="submit" aria-disabled={pending} className={actionClass}>
        {pending ? t("freezing") : t("freezeAction")}
      </Button>
      <p role="status" className="sr-only">{pending ? t("freezing") : ""}</p>
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
  const [notice, setNotice] = useState<Notice | null>(null);
  const matched = pins.filter((pin) => pin.protocolId === protocol.protocolId && pin.version === protocol.version);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const runId = String(data.get("runId") ?? "").trim();
    const parsedRunId = brandIdSchema.safeParse(runId);
    const parsed = pinSamplingProtocolSchema.safeParse({ protocolId: protocol.protocolId, version: protocol.version });
    if (!parsedRunId.success || !parsed.success) {
      setNotice({ kind: "alert", text: t("INVALID_INPUT") });
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/monitoring/runs/${parsedRunId.data}/protocol`, {
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
      setNotice({ kind: "status", text: t("pinned") });
      form.reset();
      router.refresh();
    } catch {
      setNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid min-w-0 gap-3 border-t pt-3">
      <h4 className="text-sm font-medium">{t("pinTitle")}</h4>
      <NoticeBanner notice={notice} />
      {matched.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-background px-3 py-2 text-sm leading-6 text-muted-foreground">{t("pinEmpty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {matched.map((pin) => (
            <li key={pin.runId} className="rounded-lg border bg-background px-3 py-2 text-sm leading-6 [overflow-wrap:anywhere]">
              {t("pinLine", { runId: pin.runId, version: pin.version })}
            </li>
          ))}
        </ul>
      )}
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={`pin-run-${protocol.id}`}>{t("runId")}</Label>
        <Input
          id={`pin-run-${protocol.id}`}
          name="runId"
          type="text"
          required
          maxLength={36}
          autoComplete="off"
          spellCheck={false}
          readOnly={pending}
          className={inputClass}
        />
      </div>
      <Button type="submit" variant="outline" aria-disabled={pending} className={actionClass}>
        {pending ? t("pinning") : t("pinAction")}
      </Button>
      <p role="status" className="sr-only">{pending ? t("pinning") : ""}</p>
    </form>
  );
}

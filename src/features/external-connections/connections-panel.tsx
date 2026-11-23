"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import {
  externalConnectionErrors,
  type ExternalActionView,
  type ExternalConnectionError,
  type ExternalConnectionView,
} from "./contracts.ts";

type Copy = Messages["externalConnections"];
type Translator = (key: keyof Copy) => string;

const selectClass = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

function noticeFrom(payload: unknown, t: Translator) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return t("SERVICE_UNAVAILABLE");
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return t("SERVICE_UNAVAILABLE");
  return error.code in externalConnectionErrors ? t(error.code as ExternalConnectionError) : t("SERVICE_UNAVAILABLE");
}

function emptyToNull(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text.length === 0 ? null : text;
}

function connectionStatus(status: ExternalConnectionView["status"], t: Translator) {
  if (status === "pending") return t("statusPending");
  if (status === "verified") return t("statusVerified");
  return t("statusRevoked");
}

function actionStatus(status: ExternalActionView["status"], t: Translator) {
  if (status === "confirmed") return t("statusConfirmed");
  if (status === "acknowledged") return t("statusAcknowledged");
  if (status === "unknown") return t("statusUnknown");
  if (status === "failed") return t("statusFailed");
  return t("statusReconciled");
}

function reasonText(reason: ExternalActionView["reason"], t: Translator) {
  if (reason === "manual_followup") return t("reasonManual");
  if (reason === "needs_confirmation") return t("reasonConfirmation");
  return t("reasonOk");
}

export function ConnectionsPanel({ brands, connections, labels, messages }: {
  brands: { id: string }[];
  connections: ExternalConnectionView[];
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
        <ConnectionCard key={connection.id} connection={connection} label={labelFor(connection.brandId)} t={t} />
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
      const response = await fetch("/api/settings/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: String(form.get("brandId") ?? ""),
          label: String(form.get("label") ?? "").trim(),
          canRead: form.get("canRead") === "on",
          canDraft: form.get("canDraft") === "on",
          canPublish: form.get("canPublish") === "on",
        }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath("/dashboard/settings/connections", "session-required"));
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

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="font-medium">{t("register")}</h2>
      {notice && <p role="status" className="text-sm leading-6">{notice}</p>}
      <label className="block space-y-1 text-sm">
        <span>{t("brand")}</span>
        <select name="brandId" required className={selectClass} defaultValue={brands[0]?.id}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{labelFor(brand.id)}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        <span>{t("label")}</span>
        <Input name="label" required maxLength={80} autoComplete="off" />
        <span className="block text-muted-foreground">{t("labelHint")}</span>
      </label>
      <fieldset className="space-y-2 text-sm">
        <legend className="font-medium">{t("capabilities")}</legend>
        <label className="flex items-center gap-2"><input name="canRead" type="checkbox" /><span>{t("canRead")}</span></label>
        <label className="flex items-center gap-2"><input name="canDraft" type="checkbox" defaultChecked /><span>{t("canDraft")}</span></label>
        <label className="flex items-center gap-2"><input name="canPublish" type="checkbox" /><span>{t("canPublish")}</span></label>
      </fieldset>
      <Button type="submit" disabled={pending}>{pending ? t("registering") : t("register")}</Button>
    </form>
  );
}

function ConnectionCard({ connection, label, t }: {
  connection: ExternalConnectionView;
  label: string;
  t: Translator;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const enabled = [
    connection.canRead ? t("canRead") : null,
    connection.canDraft ? t("canDraft") : null,
    connection.canPublish ? t("canPublish") : null,
  ].filter((item) => item !== null);

  async function post(path: string, body: unknown, form?: HTMLFormElement) {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath("/dashboard/settings/connections", "session-required"));
          return;
        }
        setNotice(noticeFrom(await response.json(), t));
        return;
      }
      setNotice(t("saved"));
      form?.reset();
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void post(`/api/settings/connections/${connection.id}/actions`, {
      idempotencyKey: String(data.get("idempotencyKey") ?? "").trim(),
      confirmed: data.get("confirmed") === "on",
      remoteState: emptyToNull(data.get("remoteState")),
      receiptKind: emptyToNull(data.get("receiptKind")),
      effectiveAt: emptyToNull(data.get("effectiveAt")),
    }, form);
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <div className="space-y-1">
        <h2 className="font-medium">{connection.label}</h2>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-sm">{t("status")}: {connectionStatus(connection.status, t)}</p>
        <p className="text-sm">{t("capabilities")}: {enabled.length === 0 ? t("no") : enabled.join(" / ")}</p>
      </div>
      {notice && <p role="status" className="text-sm leading-6">{notice}</p>}
      <div className="flex flex-wrap gap-2">
        {connection.status === "pending" && (
          <Button type="button" variant="outline" disabled={pending} onClick={() => void post("/api/settings/connections", { id: connection.id, status: "verified" })}>
            {t("verify")}
          </Button>
        )}
        {connection.status !== "revoked" && (
          <Button type="button" variant="outline" disabled={pending} onClick={() => void post("/api/settings/connections", { id: connection.id, status: "revoked" })}>
            {t("revoke")}
          </Button>
        )}
      </div>
      {connection.status === "revoked" && <p className="text-sm leading-6 text-muted-foreground">{t("revokedNote")}</p>}
      <p className="text-sm leading-6 text-muted-foreground">{t("historyKept")}</p>
      <h3 className="text-sm font-medium">{t("actions")}</h3>
      {connection.actions.length === 0 ? <p className="text-sm text-muted-foreground">{t("emptyActions")}</p> : (
        <ul className="space-y-3">
          {connection.actions.map((action) => (
            <li key={action.id} className="space-y-1 rounded-lg border p-3 text-sm">
              <p>{action.idempotencyKey}</p>
              <p>{t("status")}: {actionStatus(action.status, t)}</p>
              <p>{t("reason")}: {reasonText(action.reason, t)}</p>
              <p>{t("receiptKind")}: {action.receiptKind === "draft_created" ? t("receiptDraft") : action.receiptKind === "public_url" ? t("receiptPublic") : t("receiptEmpty")}</p>
              <p>{t("effectiveAt")}: {action.effectiveAt ?? t("effectiveEmpty")}</p>
              <p>{t("countsAsPublic")}: {action.countsAsPublic ? t("yes") : t("notPublic")}</p>
              <p>{t("interventionEffective")}: {action.interventionEffective ? t("yes") : t("no")}</p>
              {(action.status === "unknown" || action.status === "acknowledged") && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => void post(`/api/settings/connections/${connection.id}/actions/${action.id}/retry`, {
                    remoteState: null,
                    receiptKind: null,
                    effectiveAt: null,
                  })}
                >
                  {t("retry")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {connection.status !== "revoked" && (
        <form onSubmit={submitAction} className="space-y-3">
          <p className="text-sm leading-6 text-muted-foreground">{t("reconcileNote")}</p>
          <label className="block space-y-1 text-sm">
            <span>{t("idempotencyKey")}</span>
            <Input name="idempotencyKey" required minLength={8} maxLength={80} autoComplete="off" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input name="confirmed" type="checkbox" />
            <span>{t("confirmed")}</span>
          </label>
          <label className="block space-y-1 text-sm">
            <span>{t("remoteState")}</span>
            <select name="remoteState" className={selectClass} defaultValue="">
              <option value="">{t("remoteEmpty")}</option>
              <option value="acknowledged">{t("remoteAcknowledged")}</option>
              <option value="unknown">{t("remoteUnknown")}</option>
              <option value="failed">{t("remoteFailed")}</option>
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>{t("receiptKind")}</span>
            <select name="receiptKind" className={selectClass} defaultValue="">
              <option value="">{t("receiptEmpty")}</option>
              <option value="draft_created">{t("receiptDraft")}</option>
              <option value="public_url">{t("receiptPublic")}</option>
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>{t("effectiveAt")}</span>
            <Input name="effectiveAt" autoComplete="off" placeholder="2026-11-23T00:00:00.000Z" />
          </label>
          <Button type="submit" disabled={pending}>{pending ? t("registering") : t("submitAction")}</Button>
        </form>
      )}
    </section>
  );
}

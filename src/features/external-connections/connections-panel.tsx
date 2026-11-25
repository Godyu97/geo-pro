"use client";

import { useRef, useState, type FormEvent } from "react";
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
  externalConnectionErrors,
  type ExternalActionView,
  type ExternalConnectionError,
  type ExternalConnectionView,
} from "./contracts.ts";

type Copy = Messages["externalConnections"];
type Translator = (key: keyof Copy) => string;
type Notice = ExternalConnectionError | "saved";

const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal aria-disabled:opacity-50";
const checkboxClass = "size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const selectClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-ring";

function errorFrom(payload: unknown): ExternalConnectionError {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return "SERVICE_UNAVAILABLE";
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return "SERVICE_UNAVAILABLE";
  return Object.hasOwn(externalConnectionErrors, error.code) ? error.code as ExternalConnectionError : "SERVICE_UNAVAILABLE";
}

function OperationNotice({ notice, t }: { notice: Notice | null; t: Translator }) {
  return (
    <p role="status" className={notice === "saved" ? "text-sm leading-6" : "text-sm leading-6 text-destructive empty:sr-only"}>
      {notice && t(notice)}
    </p>
  );
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

export function ConnectionsPanel({ brands, connections, labels, brandFieldId, messages }: {
  brands: { id: string }[];
  connections: ExternalConnectionView[];
  labels: { brandId: string; name: string }[];
  brandFieldId: string;
  messages: Copy;
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const labelFor = (brandId: string) => labels.find((label) => label.brandId === brandId)?.name ?? brandId;

  return (
    <div className="min-w-0 space-y-6">
      {brands.length > 0 && <RegisterForm brands={brands} brandFieldId={brandFieldId} labelFor={labelFor} t={t} />}
      {connections.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground">{t("emptyConnections")}</p>
      ) : (
        <div className="space-y-4">
          {connections.map((connection) => (
            <ConnectionCard key={connection.id} connection={connection} label={labelFor(connection.brandId)} t={t} />
          ))}
        </div>
      )}
    </div>
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
      const response = await fetch("/api/settings/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: String(data.get("brandId") ?? ""),
          label: String(data.get("label") ?? "").trim(),
          canRead: data.get("canRead") === "on",
          canDraft: data.get("canDraft") === "on",
          canPublish: data.get("canPublish") === "on",
        }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath("/dashboard/settings/connections", "session-required"));
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

  return (
    <form onSubmit={submit} aria-labelledby="external-connection-registration" className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
      <h2 id="external-connection-registration" className="text-lg font-semibold">{t("register")}</h2>
      <label className="block space-y-1 text-sm">
        <span>{t("brand")}</span>
        <select id={brandFieldId} name="brandId" required className={`${selectClass} scroll-mt-20`} defaultValue={brands[0]?.id}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{labelFor(brand.id)}</option>)}
        </select>
      </label>
      <div className="space-y-1 text-sm">
        <label htmlFor="external-connection-label">{t("label")}</label>
        <Input id="external-connection-label" name="label" required maxLength={80} autoComplete="off"
          aria-describedby="external-connection-label-hint" />
        <p id="external-connection-label-hint" className="text-muted-foreground">{t("labelHint")}</p>
      </div>
      <fieldset className="space-y-2 text-sm">
        <legend className="font-medium">{t("capabilities")}</legend>
        <label className="flex items-center gap-2"><input name="canRead" type="checkbox" className={checkboxClass} /><span>{t("canRead")}</span></label>
        <label className="flex items-center gap-2"><input name="canDraft" type="checkbox" className={checkboxClass} defaultChecked /><span>{t("canDraft")}</span></label>
        <label className="flex items-center gap-2"><input name="canPublish" type="checkbox" className={checkboxClass} /><span>{t("canPublish")}</span></label>
      </fieldset>
      <Button type="submit" aria-disabled={pending} className={actionClass}>{pending ? t("registering") : t("register")}</Button>
      <OperationNotice notice={notice} t={t} />
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
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const revokedOnClose = useRef(false);
  const titleId = `external-connection-${connection.id}`;
  const revoked = connection.status === "revoked";
  const enabled = [
    connection.canRead ? t("canRead") : null,
    connection.canDraft ? t("canDraft") : null,
    connection.canPublish ? t("canPublish") : null,
  ].filter((item) => item !== null);

  async function post(path: string, body: unknown, onSaved?: () => void) {
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
        setNotice(errorFrom(await response.json()));
        return;
      }
      setNotice("saved");
      onSaved?.();
      router.refresh();
    } catch {
      setNotice("SERVICE_UNAVAILABLE");
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
    }, () => form.reset());
  }

  return (
    <article aria-labelledby={titleId} className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
      <div className="space-y-1 [overflow-wrap:anywhere]">
        <h2 id={titleId} ref={heading} tabIndex={-1}
          className="scroll-mt-20 rounded-sm text-lg font-semibold focus-visible:ring-2 focus-visible:ring-ring">
          {connection.label}
        </h2>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
      <dl className="space-y-1 text-sm">
        <dt className="font-medium">{t("status")}</dt>
        <dd><Badge variant={revoked ? "outline" : "secondary"}>{connectionStatus(connection.status, t)}</Badge></dd>
        <dt className="font-medium">{t("capabilities")}</dt>
        <dd>{enabled.length === 0 ? t("no") : enabled.join(" / ")}</dd>
      </dl>
      {!confirming && <OperationNotice notice={notice} t={t} />}
      <div className="flex flex-wrap gap-2">
        {connection.status === "pending" && (
          <Button type="button" variant="outline" aria-disabled={pending} className={actionClass}
            onClick={() => void post("/api/settings/connections", { id: connection.id, status: "verified" }, () => heading.current?.focus())}>
            {t("verify")}
          </Button>
        )}
        {!revoked && (
          <Dialog open={confirming} onOpenChange={(open) => {
            if (pending) return;
            setNotice(null);
            setConfirming(open);
          }}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" aria-disabled={pending} className={actionClass}>{t("revoke")}</Button>
            </DialogTrigger>
            <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
              onCloseAutoFocus={(event) => {
                if (!revokedOnClose.current) return;
                event.preventDefault();
                heading.current?.focus();
              }}>
              <DialogHeader>
                <DialogTitle>{t("revoke")}</DialogTitle>
                <DialogDescription>{t("revokeImpact")}</DialogDescription>
              </DialogHeader>
              <OperationNotice notice={notice} t={t} />
              <DialogFooter className="flex-col">
                <DialogClose asChild>
                  <Button type="button" variant="outline" aria-disabled={pending} className={actionClass}>{t("cancel")}</Button>
                </DialogClose>
                <Button type="button" variant="destructive" aria-disabled={pending} className={actionClass}
                  onClick={() => void post("/api/settings/connections", { id: connection.id, status: "revoked" }, () => {
                    revokedOnClose.current = true;
                    setConfirming(false);
                  })}>
                  {pending ? t("registering") : t("confirmRevoke")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      {revoked && <p className="text-sm leading-6 text-muted-foreground">{t("revokedNote")}</p>}
      <h3 className="text-sm font-medium">{t("actions")}</h3>
      {connection.actions.length === 0 ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{t("emptyActions")}</p> : (
        <ul className="space-y-3">
          {connection.actions.map((action) => (
            <li key={action.id} className="min-w-0 space-y-1 rounded-lg border p-3 text-sm [overflow-wrap:anywhere]">
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
                  aria-disabled={pending}
                  className={actionClass}
                  onClick={() => void post(`/api/settings/connections/${connection.id}/actions/${action.id}/retry`, {
                    remoteState: null,
                    receiptKind: null,
                    effectiveAt: null,
                  }, () => heading.current?.focus())}
                >
                  {t("retry")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!revoked && (
        <form onSubmit={submitAction} aria-label={t("submitAction")} className="min-w-0 space-y-3 border-t pt-4">
          <p className="text-sm leading-6 text-muted-foreground">{t("reconcileNote")}</p>
          <label className="block space-y-1 text-sm">
            <span>{t("idempotencyKey")}</span>
            <Input name="idempotencyKey" required minLength={8} maxLength={80} autoComplete="off" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input name="confirmed" type="checkbox" className={checkboxClass} />
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
          <Button type="submit" aria-disabled={pending} className={actionClass}>{pending ? t("registering") : t("submitAction")}</Button>
        </form>
      )}
    </article>
  );
}

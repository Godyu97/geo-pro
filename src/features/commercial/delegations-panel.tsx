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
import { formatDateTime } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { delegationErrors, type DelegationError, type DelegationWorkspace, type ManagedDelegationView } from "./contracts.ts";

type Copy = Messages["delegations"];
type Translator = (key: keyof Copy) => string;
type Notice = DelegationError | "saved" | "reasonGrant" | "statusQueued" | "statusStopped";

const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal aria-disabled:opacity-50";
const fieldClass = "h-10 w-full min-w-0 scroll-mt-20 rounded-lg border border-input bg-background px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const surfaceClass = "min-w-0 space-y-4 rounded-xl border bg-card p-4";
const emptyClass = "rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground";
const sectionHeadingClass = "scroll-mt-20 rounded-sm text-lg font-semibold focus-visible:ring-2 focus-visible:ring-ring";

function errorFrom(payload: unknown): DelegationError {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return "SERVICE_UNAVAILABLE";
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return "SERVICE_UNAVAILABLE";
  return Object.hasOwn(delegationErrors, error.code) ? error.code as DelegationError : "SERVICE_UNAVAILABLE";
}

function OperationNotice({ notice, t }: { notice: Notice | null; t: Translator }) {
  const isError = notice !== null && Object.hasOwn(delegationErrors, notice);
  return (
    <p role="status" className={isError ? "text-sm leading-6 text-destructive" : "text-sm leading-6 empty:sr-only"}>
      {notice && t(notice)}
    </p>
  );
}

function actionStatus(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("action" in payload) || !("reason" in payload)) return null;
  const action = payload.action;
  if (!action || typeof action !== "object" || !("status" in action)) return null;
  if (action.status !== "queued" && action.status !== "stopped") return null;
  return { status: action.status, grant: payload.reason === "grant" };
}

export function DelegationsPanel({ workspace, now, messages }: { workspace: DelegationWorkspace; now: string; messages: Copy }) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  return (
    <div className="min-w-0 space-y-6">
      {workspace.brands.length === 0 ? <p className={emptyClass}>{t("noBrands")}</p> : (
        <DelegationForm brands={workspace.brands} t={t} />
      )}
      <MembershipForm t={t} />
      <section className="space-y-3" aria-labelledby="delegation-portfolio-heading">
        <h2 id="delegation-portfolio-heading" tabIndex={-1} className={sectionHeadingClass}>{t("summary")}</h2>
        {workspace.portfolio.length === 0 ? <p className={emptyClass}>{t("emptyPortfolio")}</p> : workspace.portfolio.map((row) => (
          <article key={row.delegationId} aria-labelledby={`delegation-portfolio-${row.delegationId}`} className={surfaceClass}>
            <h3 id={`delegation-portfolio-${row.delegationId}`} className="text-sm font-medium [overflow-wrap:anywhere]">{row.brandId}</h3>
            <Badge variant={row.summary === "visible" ? "secondary" : "outline"}>{t(row.summary === "visible" ? "summaryVisible" : "summaryBlocked")}</Badge>
            {row.summary === "visible" && row.evidenceIds.length > 0 ? (
              <div className="space-y-1">
                <h4 className="text-sm font-medium">{t("evidence")}</h4>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {row.evidenceIds.map((id) => <li key={id} className="break-all">{id}</li>)}
                </ul>
              </div>
            ) : <p className="text-sm text-muted-foreground">{t("noEvidence")}</p>}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">{t("actions")}</h4>
              {workspace.actions.filter((action) => action.delegationId === row.delegationId).map((action) => (
                <ActionButton key={action.id} actionId={action.id} status={action.status} t={t} />
              ))}
            </div>
          </article>
        ))}
      </section>
      <section className="space-y-3" aria-labelledby="delegation-managed-heading">
        <h2 id="delegation-managed-heading" tabIndex={-1} className={sectionHeadingClass}>{t("managedTitle")}</h2>
        {workspace.managed.length === 0 ? <p className={emptyClass}>{t("emptyManaged")}</p> : workspace.managed.map((row) => {
          const date = new Date(row.expiresAt);
          const expiry = Number.isNaN(date.getTime()) ? row.expiresAt : formatDateTime(locale, date, "UTC");
          return (
            <ManagedRow key={row.id} row={row} brandName={workspace.brands.find(({ id }) => id === row.brandId)?.name ?? row.brandId}
              expiry={expiry} expired={row.expiresAt <= now} t={t} />
          );
        })}
      </section>
    </div>
  );
}

function MembershipForm({ t }: { t: Translator }) {
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
      const response = await fetch("/api/settings/delegations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: String(data.get("organizationId") ?? "").trim(),
          userId: String(data.get("userId") ?? "").trim(),
        }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath("/dashboard/settings/delegations", "session-required"));
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
    <form onSubmit={submit} aria-labelledby="delegation-membership-form" className={surfaceClass}>
      <h2 id="delegation-membership-form" className="text-lg font-semibold">{t("membershipTitle")}</h2>
      <label className="block space-y-1 text-sm" htmlFor="delegation-organization">
        <span>{t("organizationId")}</span>
        <Input id="delegation-organization" name="organizationId" required maxLength={36} autoComplete="off" className="scroll-mt-20" />
      </label>
      <label className="block space-y-1 text-sm" htmlFor="delegation-user">
        <span>{t("userId")}</span>
        <Input id="delegation-user" name="userId" required maxLength={128} autoComplete="off" />
      </label>
      <Button type="submit" aria-disabled={pending} className={actionClass}>{pending ? t("saving") : t("registerMembership")}</Button>
      <OperationNotice notice={notice} t={t} />
    </form>
  );
}

function DelegationForm({ brands, t }: { brands: { id: string; name: string }[]; t: Translator }) {
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
      const response = await fetch("/api/settings/delegations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: String(data.get("brandId") ?? ""),
          organizationId: String(data.get("organizationId") ?? "").trim(),
          expiresAt: String(data.get("expiresAt") ?? "").trim(),
          scope: String(data.get("scope") ?? "").trim(),
        }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath("/dashboard/settings/delegations", "session-required"));
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
    <form onSubmit={submit} aria-labelledby="delegation-registration-form" className={surfaceClass}>
      <h2 id="delegation-registration-form" className="text-lg font-semibold">{t("delegationTitle")}</h2>
      <label className="block space-y-1 text-sm" htmlFor="delegation-brand">
        <span>{t("brand")}</span>
        <select id="delegation-brand" name="brandId" required className={fieldClass}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm" htmlFor="delegation-target-org">
        <span>{t("organizationId")}</span>
        <Input id="delegation-target-org" name="organizationId" required maxLength={36} autoComplete="off" />
      </label>
      <label className="block space-y-1 text-sm" htmlFor="delegation-expires">
        <span>{t("expiresAtUtc")}</span>
        <Input id="delegation-expires" name="expiresAt" required maxLength={40} autoComplete="off" placeholder="YYYY-MM-DDTHH:mm:ss.sssZ" />
      </label>
      <div className="space-y-1 text-sm">
        <label htmlFor="delegation-scope">{t("scope")}</label>
        <Input id="delegation-scope" name="scope" required maxLength={600} autoComplete="off" aria-describedby="delegation-scope-hint" />
        <p id="delegation-scope-hint" className="text-muted-foreground">{t("scopeHint")}</p>
      </div>
      <Button type="submit" aria-disabled={pending} className={actionClass}>{pending ? t("saving") : t("registerDelegation")}</Button>
      <OperationNotice notice={notice} t={t} />
    </form>
  );
}

function ActionButton({ actionId, status, t }: { actionId: string; status: "queued" | "stopped"; t: Translator }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function execute() {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/settings/delegations/actions/${actionId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath("/dashboard/settings/delegations", "session-required"));
          return;
        }
        setNotice(errorFrom(await response.json()));
        return;
      }
      const outcome = actionStatus(await response.json());
      if (!outcome) {
        setNotice("SERVICE_UNAVAILABLE");
        return;
      }
      if (outcome.grant) setNotice("reasonGrant");
      else setNotice(outcome.status === "queued" ? "statusQueued" : "statusStopped");
      router.refresh();
    } catch {
      setNotice("SERVICE_UNAVAILABLE");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" disabled={status === "stopped"} aria-disabled={pending} className={actionClass} onClick={() => void execute()}>
        {pending ? t("saving") : t("execute")}
      </Button>
      <span className="text-sm text-muted-foreground">{status === "queued" ? t("statusQueued") : t("statusStopped")}</span>
      <OperationNotice notice={notice} t={t} />
    </div>
  );
}

function ManagedRow({ row, brandName, expiry, expired, t }: {
  row: ManagedDelegationView;
  brandName: string;
  expiry: string;
  expired: boolean;
  t: Translator;
}) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const expiredOnClose = useRef(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const titleId = `delegation-managed-${row.id}`;
  const ended = row.active === 0 || notice === "saved";
  const status = ended ? "statusEnded" : expired ? "statusExpired" : "statusActive";

  async function expire() {
    if (pending || ended) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/settings/delegations/${row.id}/expire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath("/dashboard/settings/delegations", "session-required"));
          return;
        }
        setNotice(errorFrom(await response.json()));
        return;
      }
      setNotice("saved");
      expiredOnClose.current = true;
      setConfirming(false);
      router.refresh();
    } catch {
      setNotice("SERVICE_UNAVAILABLE");
    } finally {
      setPending(false);
    }
  }

  return (
    <article aria-labelledby={titleId} className={surfaceClass}>
      <h3 id={titleId} ref={heading} tabIndex={-1} className={`${sectionHeadingClass} [overflow-wrap:anywhere]`}>{brandName}</h3>
      <Badge variant={status === "statusActive" ? "secondary" : "outline"}>{t(status)}</Badge>
      <dl className="space-y-1 text-sm [overflow-wrap:anywhere]">
        <dt className="font-medium">{t("organizationId")}</dt>
        <dd>{row.organizationId}</dd>
        <dt className="font-medium">{t("expiresAtUtc")}</dt>
        <dd><time dateTime={row.expiresAt} title={row.expiresAt}>{expiry}</time></dd>
      </dl>
      {!confirming && <OperationNotice notice={notice} t={t} />}
      <Dialog open={confirming} onOpenChange={(open) => {
        if (pending) return;
        setNotice(null);
        setConfirming(open);
      }}>
        {!ended && (
          <DialogTrigger asChild>
            <Button type="button" variant="outline" className={actionClass}>{t("expire")}</Button>
          </DialogTrigger>
        )}
        <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            if (!expiredOnClose.current) return;
            event.preventDefault();
            heading.current?.focus();
          }}>
          <DialogHeader>
            <DialogTitle>{t("expire")}</DialogTitle>
            <DialogDescription>{t("expireImpact")}</DialogDescription>
          </DialogHeader>
          <OperationNotice notice={notice} t={t} />
          <DialogFooter className="flex-col">
            <DialogClose asChild>
              <Button type="button" variant="outline" aria-disabled={pending} className={actionClass}>{t("cancel")}</Button>
            </DialogClose>
            <Button type="button" variant="destructive" aria-disabled={pending} className={actionClass} onClick={() => void expire()}>
              {pending ? t("saving") : t("confirmExpiry")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}

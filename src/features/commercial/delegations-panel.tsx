"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { delegationErrors, type DelegationError, type DelegationWorkspace } from "./contracts.ts";

type Copy = Messages["delegations"];
type Translator = (key: keyof Copy) => string;

const fieldClass = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

function noticeFrom(payload: unknown, t: Translator) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return t("SERVICE_UNAVAILABLE");
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return t("SERVICE_UNAVAILABLE");
  return error.code in delegationErrors ? t(error.code as DelegationError) : t("SERVICE_UNAVAILABLE");
}

function actionStatus(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("action" in payload) || !("reason" in payload)) return null;
  const action = payload.action;
  if (!action || typeof action !== "object" || !("status" in action)) return null;
  if (action.status !== "queued" && action.status !== "stopped") return null;
  return { status: action.status, grant: payload.reason === "grant" };
}

export function DelegationsPanel({ workspace, messages }: { workspace: DelegationWorkspace; messages: Copy }) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  return (
    <div className="min-w-0 space-y-6">
      <MembershipForm t={t} />
      {workspace.brands.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("noBrands")}</p> : (
        <DelegationForm brands={workspace.brands} t={t} />
      )}
      <section className="space-y-3" aria-labelledby="delegation-portfolio-heading">
        <h2 id="delegation-portfolio-heading" className="text-base font-semibold">{t("summary")}</h2>
        {workspace.portfolio.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("emptyPortfolio")}</p> : workspace.portfolio.map((row) => (
          <article key={row.delegationId} className="space-y-3 rounded-xl border p-5">
            <p className="text-sm">{row.summary === "visible" ? t("summaryVisible") : t("summaryBlocked")}</p>
            <p className="break-all text-sm text-muted-foreground">{row.brandId}</p>
            {row.summary === "visible" && row.evidenceIds.length > 0 ? (
              <div className="space-y-1">
                <h3 className="text-sm font-medium">{t("evidence")}</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {row.evidenceIds.map((id) => <li key={id} className="break-all">{id}</li>)}
                </ul>
              </div>
            ) : <p className="text-sm text-muted-foreground">{t("noEvidence")}</p>}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">{t("actions")}</h3>
              {workspace.actions.filter((action) => action.delegationId === row.delegationId).map((action) => (
                <ActionButton key={action.id} actionId={action.id} status={action.status} t={t} />
              ))}
            </div>
          </article>
        ))}
      </section>
      <section className="space-y-3" aria-labelledby="delegation-managed-heading">
        <h2 id="delegation-managed-heading" className="text-base font-semibold">{t("expire")}</h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("keptAfterExpiry")}</p>
        {workspace.managed.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("emptyManaged")}</p> : workspace.managed.map((row) => (
          <ManagedRow key={row.id} delegationId={row.id} brandId={row.brandId} active={row.active} t={t} />
        ))}
      </section>
    </div>
  );
}

function MembershipForm({ t }: { t: Translator }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
    <form onSubmit={submit} className="space-y-3 rounded-xl border p-5">
      <h2 className="text-base font-semibold">{t("membershipTitle")}</h2>
      <label className="block space-y-1 text-sm" htmlFor="delegation-organization">
        <span>{t("organizationId")}</span>
        <Input id="delegation-organization" name="organizationId" required maxLength={36} autoComplete="off" />
      </label>
      <label className="block space-y-1 text-sm" htmlFor="delegation-user">
        <span>{t("userId")}</span>
        <Input id="delegation-user" name="userId" required maxLength={128} autoComplete="off" />
      </label>
      <Button type="submit" disabled={pending}>{pending ? t("saving") : t("registerMembership")}</Button>
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </form>
  );
}

function DelegationForm({ brands, t }: { brands: { id: string; name: string }[]; t: Translator }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
    <form onSubmit={submit} className="space-y-3 rounded-xl border p-5">
      <h2 className="text-base font-semibold">{t("delegationTitle")}</h2>
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
        <span>{t("expiresAt")}</span>
        <Input id="delegation-expires" name="expiresAt" required maxLength={40} autoComplete="off" placeholder="2026-12-31T00:00:00.000Z" />
      </label>
      <label className="block space-y-1 text-sm" htmlFor="delegation-scope">
        <span>{t("scope")}</span>
        <Input id="delegation-scope" name="scope" required maxLength={600} autoComplete="off" />
        <span className="text-muted-foreground">{t("scopeHint")}</span>
      </label>
      <Button type="submit" disabled={pending}>{pending ? t("saving") : t("registerDelegation")}</Button>
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </form>
  );
}

function ActionButton({ actionId, status, t }: { actionId: string; status: "queued" | "stopped"; t: Translator }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
        setNotice(noticeFrom(await response.json(), t));
        return;
      }
      const outcome = actionStatus(await response.json());
      if (outcome?.grant) setNotice(t("reasonGrant"));
      else if (outcome?.status === "queued") setNotice(t("statusQueued"));
      else setNotice(t("statusStopped"));
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" disabled={pending || status === "stopped"} onClick={() => void execute()}>
        {pending ? t("saving") : t("execute")}
      </Button>
      <span className="text-sm text-muted-foreground">{status === "queued" ? t("statusQueued") : t("statusStopped")}</span>
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </div>
  );
}

function ManagedRow({ delegationId, brandId, active, t }: {
  delegationId: string;
  brandId: string;
  active: 0 | 1;
  t: Translator;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function expire() {
    if (pending || active === 0) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/settings/delegations/${delegationId}/expire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath("/dashboard/settings/delegations", "session-required"));
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
    <article className="space-y-3 rounded-xl border p-5">
      <p className="break-all text-sm text-muted-foreground">{brandId}</p>
      <p className="text-sm">{active === 1 ? t("summaryVisible") : t("summaryBlocked")}</p>
      <Button type="button" variant="outline" disabled={pending || active === 0} onClick={() => void expire()}>
        {pending ? t("saving") : t("expire")}
      </Button>
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </article>
  );
}

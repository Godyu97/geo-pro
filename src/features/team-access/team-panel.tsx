"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { teamErrors, type TeamError, type TeamInviteStatus, type TeamLabel, type TeamListView } from "./contracts.ts";

export function TeamPanel({ labels, workspace, messages }: {
  labels: TeamLabel[];
  workspace: TeamListView;
  messages: Messages["teamAccess"];
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const labelFor = (brandId: string) => labels.find((label) => label.brandId === brandId)?.name ?? t("grantedBrand");
  const inviteStatus: Record<TeamInviteStatus, "inviteStatusOpen" | "inviteStatusAccepted" | "inviteStatusExpired" | "inviteStatusRevoked"> = {
    open: "inviteStatusOpen",
    accepted: "inviteStatusAccepted",
    expired: "inviteStatusExpired",
    revoked: "inviteStatusRevoked",
  };

  async function fail(response: Response) {
    if (response.status === 401) {
      window.location.replace(loginPath("/dashboard/settings/team", "session-required"));
      return;
    }
    const body = await response.json() as { error?: { code?: TeamError } };
    const code = body.error?.code;
    setNotice(code && code in teamErrors ? t(code) : t("SERVICE_UNAVAILABLE"));
  }

  async function send(key: string, url: string, init: RequestInit, ok: string) {
    if (pending) return;
    setPending(key);
    setNotice(null);
    try {
      const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
      if (!response.ok) return await fail(response);
      setNotice(ok);
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(null);
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const expiresAt = String(fields.get("expiresAt") ?? "").trim();
    if (pending) return;
    setPending("invite");
    setNotice(null);
    try {
      const response = await fetch("/api/team/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: String(fields.get("userId") ?? ""),
          brandId: String(fields.get("brandId") ?? ""),
          ...(expiresAt ? { expiresAt } : {}),
        }),
      });
      if (!response.ok) return await fail(response);
      const body = await response.json() as { token?: string };
      setNotice(typeof body.token === "string" ? `${t("invited")} ${body.token}` : t("SERVICE_UNAVAILABLE"));
      if (typeof body.token === "string") form.reset();
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(null);
    }
  }

  async function resendInvite(invitationId: string) {
    if (pending) return;
    setPending(`resend:${invitationId}`);
    setNotice(null);
    try {
      const response = await fetch(`/api/team/invitations/${invitationId}/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) return await fail(response);
      const body = await response.json() as { token?: string };
      setNotice(typeof body.token === "string" ? `${t("resentInvite")} ${body.token}` : t("SERVICE_UNAVAILABLE"));
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(null);
    }
  }

  async function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const expiresAt = String(form.get("expiresAt") ?? "").trim();
    await send("grant", "/api/settings/team/grants", {
      method: "POST",
      body: JSON.stringify({
        userId: String(form.get("userId") ?? ""),
        brandId: String(form.get("brandId") ?? ""),
        role: String(form.get("role") ?? ""),
        expiresAt: expiresAt ? expiresAt : null,
      }),
    }, t("granted"));
  }

  async function exportBrands(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const brandId of form.getAll("brandId")) params.append("export", String(brandId));
    const extra = String(form.get("extraBrand") ?? "").trim();
    if (extra) params.append("export", extra);
    if (pending || [...params.keys()].length === 0) return;
    setPending("export");
    setNotice(null);
    try {
      const response = await fetch(`/api/settings/team/grants?${params}`, { headers: { "Content-Type": "application/json" } });
      const body = await response.json() as { allowed?: boolean; rows?: string[] };
      if (!response.ok || body.allowed !== true) {
        setNotice(t("exportDenied"));
        return;
      }
      setNotice(t("exportAllowed"));
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(null);
    }
  }

  async function execute(actionId: string) {
    if (pending) return;
    setPending(actionId);
    setNotice(null);
    try {
      const response = await fetch(`/api/settings/team/actions/${actionId}/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) return await fail(response);
      const body = await response.json() as { action?: { download?: string } };
      setNotice(body.action?.download ? t("downloadReady") : t("downloadEmpty"));
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm leading-6 text-muted-foreground">{t("inviteHidden")}</p>
      {notice && <p role="status" className="text-sm leading-6">{notice}</p>}

      <section aria-labelledby="grant-heading" className="space-y-3 rounded-xl border bg-card p-5">
        <h2 id="grant-heading" className="font-medium">{t("ownerBrands")}</h2>
        {labels.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("noBrands")}</p> : (
          <form onSubmit={grant} className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("brand")}</span>
              <select name="brandId" required className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm">
                {labels.map((label) => <option key={label.brandId} value={label.brandId}>{label.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("memberUser")}</span>
              <Input name="userId" required autoComplete="off" spellCheck={false} maxLength={128} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("role")}</span>
              <select name="role" required className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm" defaultValue="member">
                <option value="member">{t("roleMember")}</option>
                <option value="owner">{t("roleOwner")}</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("expiresAt")}</span>
              <Input name="expiresAt" autoComplete="off" spellCheck={false} placeholder="2026-12-31T00:00:00.000Z" />
              <span className="block text-muted-foreground">{t("expiresHint")}</span>
            </label>
            <div>
              <Button type="submit" disabled={pending !== null}>{pending === "grant" ? t("granting") : t("grant")}</Button>
            </div>
          </form>
        )}
      </section>

      <section aria-labelledby="invitations-heading" className="space-y-3 rounded-xl border bg-card p-5">
        <h2 id="invitations-heading" className="font-medium">{t("invitations")}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{t("invitationHint")}</p>
        {labels.length === 0 ? null : (
          <form onSubmit={invite} className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("brand")}</span>
              <select name="brandId" required className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm">
                {labels.map((label) => <option key={label.brandId} value={label.brandId}>{label.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("memberUser")}</span>
              <Input name="userId" required autoComplete="off" spellCheck={false} maxLength={128} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("expiresAt")}</span>
              <Input name="expiresAt" autoComplete="off" spellCheck={false} placeholder="2026-12-31T00:00:00.000Z" />
              <span className="block text-muted-foreground">{t("expiresHint")}</span>
            </label>
            <div className="self-end">
              <Button type="submit" disabled={pending !== null}>{pending === "invite" ? t("inviting") : t("invite")}</Button>
            </div>
          </form>
        )}
        {workspace.invitations.length === 0 ? <p className="text-sm text-muted-foreground">{t("noInvitations")}</p> : (
          <ul className="space-y-3 text-sm">
            {workspace.invitations.map((invitation) => (
              <li key={invitation.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{t(invitation.labelKey)}</span>
                  <span className="text-muted-foreground">{t("inviteBrandId")}</span>
                  <span className="break-all text-muted-foreground">{invitation.brandId}</span>
                  <span>{t(inviteStatus[invitation.status])}</span>
                  <span className="text-muted-foreground">{t("inviteAccount")}</span>
                  <span className="break-all text-muted-foreground">{invitation.inviteeUserId}</span>
                </div>
                {invitation.canResend && (
                  <Button type="button" variant="outline" disabled={pending !== null} onClick={() => resendInvite(invitation.id)}>
                    {pending === `resend:${invitation.id}` ? t("resendingInvite") : t("resendInvite")}
                  </Button>
                )}
                {invitation.canAccept && (
                  <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
                    event.preventDefault();
                    const token = String(new FormData(event.currentTarget).get("token") ?? "");
                    void send(`accept:${invitation.id}`, `/api/team/invitations/${invitation.id}/accept`, {
                      method: "POST",
                      body: JSON.stringify({ token }),
                    }, t("acceptedInvite"));
                  }}>
                    <label className="space-y-1">
                      <span className="font-medium">{t("inviteToken")}</span>
                      <Input name="token" required autoComplete="off" spellCheck={false} maxLength={43} />
                      <span className="block text-muted-foreground">{t("inviteTokenHint")}</span>
                    </label>
                    <Button type="submit" disabled={pending !== null}>
                      {pending === `accept:${invitation.id}` ? t("acceptingInvite") : t("acceptInvite")}
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="members-heading" className="space-y-3 rounded-xl border bg-card p-5">
        <h2 id="members-heading" className="font-medium">{t("members")}</h2>
        {workspace.members.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : (
          <ul className="space-y-2 text-sm">
            {workspace.members.map((member) => {
              const owners = workspace.members.filter((row) => row.brandId === member.brandId && row.role === "owner" && row.active === 1);
              const canRevoke = !(member.role === "owner" && member.active === 1 && owners.length < 2);
              return (
                <li key={member.id} className="flex flex-wrap items-center gap-2">
                  <span>{labelFor(member.brandId)}</span>
                  <span className="text-muted-foreground">{member.role === "owner" ? t("roleOwner") : t("roleMember")}</span>
                  <span className="text-muted-foreground">{member.active === 1 ? t("active") : t("inactive")}</span>
                  {member.role === "member" && member.active === 1 && (
                    <Button type="button" variant="outline" disabled={pending !== null}
                      onClick={() => send(`promote:${member.id}`, `/api/settings/team/grants/${member.id}/promote`, { method: "POST", body: "{}" }, t("promoted"))}>
                      {pending === `promote:${member.id}` ? t("promoting") : t("promote")}
                    </Button>
                  )}
                  {canRevoke && member.active === 1 && (
                    <Button type="button" variant="outline" disabled={pending !== null}
                      onClick={() => send(member.id, `/api/settings/team/grants/${member.id}/revoke`, { method: "POST", body: "{}" }, t("revoked"))}>
                      {pending === member.id ? t("revoking") : t("revoke")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="actions-heading" className="space-y-3 rounded-xl border bg-card p-5">
        <h2 id="actions-heading" className="font-medium">{t("actions")}</h2>
        {workspace.actions.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : (
          <ul className="space-y-2 text-sm">
            {workspace.actions.map((action) => (
              <li key={action.id} className="flex flex-wrap items-center gap-2">
                <span>{action.status === "queued" ? t("statusQueued") : t("statusStopped")}</span>
                {action.status === "queued" && (
                  <Button type="button" variant="outline" disabled={pending !== null} onClick={() => execute(action.id)}>
                    {pending === action.id ? t("executing") : t("execute")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="export-heading" className="space-y-3 rounded-xl border bg-card p-5">
        <h2 id="export-heading" className="font-medium">{t("selectBrands")}</h2>
        <form onSubmit={exportBrands} className="space-y-3 text-sm">
          {workspace.accessibleBrandIds.map((brandId) => (
            <label key={brandId} className="flex items-center gap-2">
              <input type="checkbox" name="brandId" value={brandId} />
              <span>{labelFor(brandId)}</span>
            </label>
          ))}
          <label className="block space-y-1">
            <span className="font-medium">{t("extraBrand")}</span>
            <Input name="extraBrand" autoComplete="off" spellCheck={false} />
            <span className="block text-muted-foreground">{t("extraBrandHint")}</span>
          </label>
          <Button type="submit" disabled={pending !== null}>{pending === "export" ? t("exporting") : t("exportBrands")}</Button>
        </form>
      </section>

      <form className="space-y-3" onSubmit={(event) => {
        event.preventDefault();
        void send("leave", "/api/settings/team/leave", { method: "POST", body: "{}" }, t("left"));
      }}>
        {workspace.ownerBrandIds.some((brandId) => workspace.members.filter((row) => row.brandId === brandId && row.role === "owner" && row.active === 1).length < 2) && (
          <p className="text-sm leading-6 text-muted-foreground">{t("lastOwner")}</p>
        )}
        <Button type="submit" variant="outline" disabled={pending !== null}>{pending === "leave" ? t("leaving") : t("leave")}</Button>
      </form>
    </div>
  );
}

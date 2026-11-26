"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import {
  teamErrors,
  type BrandActionFlags,
  type TeamError,
  type TeamGroupWorkspaceView,
  type TeamInviteStatus,
  type TeamRole,
} from "./contracts.ts";

function accountPayload(raw: string) {
  const value = raw.trim();
  return value.includes("@") ? { email: value } : { userId: value };
}

export function TeamPanel({ view, messages }: {
  view: TeamGroupWorkspaceView;
  messages: Messages["teamAccess"];
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { account, groups, activeGroup, groupBrands, groupMembers, ownerLabels: labels, workspace } = view;
  const roleLabel = (role: TeamRole) =>
    role === "owner" ? t("roleOwner") : role === "read_only" ? t("roleReadOnly") : t("roleMember");
  const actionLabels = (flags: BrandActionFlags) => {
    const items: string[] = [];
    if (flags.view) items.push(t("actionView"));
    if (flags.edit) items.push(t("actionEdit"));
    if (flags.factApprove) items.push(t("actionFactApprove"));
    if (flags.contentApprove) items.push(t("actionContentApprove"));
    if (flags.export) items.push(t("actionExport"));
    if (flags.manageMembers) items.push(t("actionManageMembers"));
    return items;
  };
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
    const accountInput = String(fields.get("userId") ?? "");
    const role = String(fields.get("role") ?? "member");
    if (pending) return;
    setPending("invite");
    setNotice(null);
    try {
      const response = await fetch("/api/team/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...accountPayload(accountInput),
          brandId: String(fields.get("brandId") ?? ""),
          groupId: activeGroup.id,
          role,
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
    const accountInput = String(form.get("userId") ?? "");
    await send("grant", "/api/settings/team/grants", {
      method: "POST",
      body: JSON.stringify({
        ...accountPayload(accountInput),
        brandId: String(form.get("brandId") ?? ""),
        groupId: activeGroup.id,
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
    <div className="min-w-0 space-y-6">
      <p className="text-sm leading-6 text-muted-foreground">{t("inviteHidden")}</p>
      {notice && <p role="status" className="text-sm leading-6">{notice}</p>}

      <section aria-labelledby="group-heading" className="min-w-0 space-y-4 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="group-heading" className="font-medium">{t("groupSection")}</h2>
          <Badge variant="outline">
            {t("platformRoleLabel")}: {account.platformRole === "admin" ? t("platformRoleAdmin") : t("platformRoleUser")}
          </Badge>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <dt className="font-medium">{t("currentAccount")}</dt>
            <dd className="break-all text-muted-foreground">{account.name} ({account.email})</dd>
            <dd className="break-all text-xs text-muted-foreground">{t("accountId")}: {account.userId}</dd>
          </div>
          <div className="min-w-0 space-y-1">
            <dt className="font-medium">{t("currentGroup")}</dt>
            <dd className="wrap-anywhere text-muted-foreground">
              {activeGroup.name} · {activeGroup.isPersonal ? t("personalGroup") : t("sharedGroup")}
            </dd>
            <dd className="break-all text-xs text-muted-foreground">{t("groupIdLabel")}: {activeGroup.id}</dd>
          </div>
        </dl>
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("switchGroup")}</p>
          <nav aria-label={t("switchGroup")} className="flex flex-wrap gap-2">
            {groups.map((group) => {
              const current = group.id === activeGroup.id;
              const href = group.isPersonal ? "/dashboard/settings/team" : `/dashboard/settings/team?groupId=${encodeURIComponent(group.id)}`;
              return (
                <Link
                  key={group.id}
                  href={href}
                  prefetch={false}
                  aria-current={current ? "page" : undefined}
                  className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${
                    current ? "border-primary bg-secondary font-medium" : "bg-background hover:bg-muted/50"
                  }`}
                >
                  <span className="wrap-anywhere">{group.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {group.isPersonal ? t("personalGroup") : t("sharedGroup")}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>
      </section>

      <section aria-labelledby="group-brands-heading" className="min-w-0 space-y-3 rounded-xl border bg-card p-5">
        <h2 id="group-brands-heading" className="font-medium">{t("groupBrands")}</h2>
        {groupBrands.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card p-4 text-sm leading-6 text-muted-foreground">{t("noGroupBrands")}</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {groupBrands.map((brand) => (
              <li key={brand.brandId} className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/dashboard/brands/${brand.brandId}`} prefetch={false} className="font-medium underline-offset-4 hover:underline">
                    {brand.name}
                  </Link>
                  <Badge variant="outline">{roleLabel(brand.role)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("allowedActions")}: {actionLabels(brand.actions).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="grant-heading" className="space-y-3 rounded-xl border bg-card p-5">
        <h2 id="grant-heading" className="font-medium">{t("ownerBrands")}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{t("groupManageScopeHint")}</p>
        {labels.length === 0 ? <p className="rounded-xl border border-dashed bg-card p-4 text-sm leading-6 text-muted-foreground">{t("noBrands")}</p> : (
          <form onSubmit={grant} className="grid gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("brand")}</span>
              <select name="brandId" required className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                {labels.map((label) => <option key={label.brandId} value={label.brandId}>{label.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("memberUser")}</span>
              <Input name="userId" required autoComplete="off" spellCheck={false} maxLength={320} placeholder={t("memberAccountPlaceholder")} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("role")}</span>
              <select name="role" required className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" defaultValue="member">
                <option value="member">{t("roleMember")}</option>
                <option value="read_only">{t("roleReadOnly")}</option>
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
        <h2 id="invitations-heading" tabIndex={-1} className="scroll-mt-5 font-medium focus-visible:outline-2 focus-visible:outline-ring">{t("invitations")}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{t("invitationHint")}</p>
        {labels.length === 0 ? null : (
          <form onSubmit={invite} className="grid gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("brand")}</span>
              <select name="brandId" required className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                {labels.map((label) => <option key={label.brandId} value={label.brandId}>{label.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("memberUser")}</span>
              <Input id="team-invite-user" className="scroll-mt-5" name="userId" required autoComplete="off" spellCheck={false} maxLength={320} placeholder={t("memberAccountPlaceholder")} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("role")}</span>
              <select name="role" required className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" defaultValue="read_only">
                <option value="read_only">{t("roleReadOnly")}</option>
                <option value="member">{t("roleMember")}</option>
              </select>
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
                  <span>{roleLabel(invitation.role)}</span>
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
        {groupMembers.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : (
          <ul className="space-y-3 text-sm">
            {groupMembers.map((member) => {
              const isOwnedBrand = workspace.ownerBrandIds.includes(member.brandId);
              const owners = groupMembers.filter((row) => row.brandId === member.brandId && row.role === "owner" && row.active === 1 && !row.expired);
              const canRevoke = isOwnedBrand && !(member.role === "owner" && member.active === 1 && owners.length < 2);
              const statusText = member.active === 1 ? (member.expired ? t("inviteStatusExpired") : t("active")) : t("inactive");
              return (
                <li key={member.grantId} className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{member.brandName}</span>
                    <span className="wrap-anywhere text-muted-foreground">
                      {member.userName}{member.userEmail ? ` (${member.userEmail})` : ""}
                    </span>
                    <Badge variant="outline">{roleLabel(member.role)}</Badge>
                    <span className="text-muted-foreground">{statusText}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("allowedActions")}: {actionLabels(member.actions).join(" · ")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {isOwnedBrand && member.role === "member" && member.active === 1 && !member.expired && (
                      <Button type="button" variant="outline" disabled={pending !== null}
                        onClick={() => send(`promote:${member.grantId}`, `/api/settings/team/grants/${member.grantId}/promote`, { method: "POST", body: "{}" }, t("promoted"))}>
                        {pending === `promote:${member.grantId}` ? t("promoting") : t("promote")}
                      </Button>
                    )}
                    {canRevoke && member.active === 1 && (
                      <Button type="button" variant="outline" disabled={pending !== null}
                        onClick={() => send(member.grantId, `/api/settings/team/grants/${member.grantId}/revoke`, { method: "POST", body: "{}" }, t("revoked"))}>
                        {pending === member.grantId ? t("revoking") : t("revoke")}
                      </Button>
                    )}
                  </div>
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
          {groupBrands.map((brand) => (
            <label key={brand.brandId} className="flex items-center gap-2">
              <input type="checkbox" name="brandId" value={brand.brandId} />
              <span>{brand.name}</span>
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

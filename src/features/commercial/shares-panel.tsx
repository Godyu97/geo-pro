"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import { formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { formatShareSample, registerShareSchema, shareErrors, type ShareError, type ShareView, type ShareWorkspace } from "./share-contracts.ts";

type Copy = Messages["shares"];
type Translator = ReturnType<typeof createTranslator<Copy>>;
const previewResponse = z.object({
  share: registerShareSchema.pick({ track: true, sampleSize: true, grade: true }).strip(),
});
type Notice = ShareError | "saved" | "revoked" | z.infer<typeof previewResponse>["share"];

const fieldClass = "scroll-mt-20 h-10 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal aria-disabled:opacity-50";
const emptyClass = "rounded-xl border border-dashed bg-card p-4 text-sm leading-6 text-muted-foreground";
const sharesPath = "/dashboard/reports/shares";
const endpoint = "/api/reports/shares";

function errorFrom(payload: unknown): ShareError {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return "SERVICE_UNAVAILABLE";
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return "SERVICE_UNAVAILABLE";
  return Object.hasOwn(shareErrors, error.code) ? error.code as ShareError : "SERVICE_UNAVAILABLE";
}

function ShareNotice({ notice, t }: { notice: Notice | null; t: Translator }) {
  const isError = typeof notice === "string" && Object.hasOwn(shareErrors, notice);
  return (
    <p role="status" className={isError ? "text-sm leading-6 text-destructive" : "text-sm leading-6 [overflow-wrap:anywhere] empty:sr-only"}>
      {typeof notice === "string" ? t(notice) : notice && t("viewed", {
        track: notice.track, sampleSize: formatShareSample(notice.sampleSize), grade: notice.grade,
      })}
    </p>
  );
}

export function SharesPanel({ workspace, messages, now }: { workspace: ShareWorkspace; messages: Copy; now: string }) {
  const { locale } = useLocale();
  const router = useRouter();
  const t = createTranslator(locale, messages);
  const names = new Map(workspace.brands.map((brand) => [brand.id, brand.name]));
  const nextExpiry = workspace.shares
    .filter((share) => share.revoked === 0 && share.expiresAt > now)
    .map((share) => share.expiresAt).sort()[0];

  useEffect(() => {
    if (!nextExpiry) return;
    const delay = Date.parse(nextExpiry) - Date.parse(now);
    if (!Number.isFinite(delay)) return;
    const timeout = window.setTimeout(() => router.refresh(), Math.min(delay, 2_147_483_647));
    return () => window.clearTimeout(timeout);
  }, [nextExpiry, now, router]);

  return (
    <div className="min-w-0 space-y-6">
      {workspace.brands.length === 0 ? <p className={emptyClass}>{t("noBrands")}</p> : <ShareForm t={t} brands={workspace.brands} />}
      <section className="space-y-3" aria-labelledby="whitelabel-shares-heading">
        <h2 id="whitelabel-shares-heading" tabIndex={-1} className="scroll-mt-20 rounded-sm text-lg font-semibold focus-visible:ring-2 focus-visible:ring-ring">
          {t("myShares")}
        </h2>
        {workspace.shares.length === 0 ? <p className={emptyClass}>{t("empty")}</p> : (
          <ul className="space-y-3">
            {workspace.shares.map((share) => (
              <li key={share.id} className="min-w-0">
                <ShareCard share={share} brandName={names.get(share.brandId) ?? share.brandId} expired={share.expiresAt <= now} locale={locale} t={t} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ShareForm({ brands, t }: { brands: ShareWorkspace["brands"]; t: Translator }) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const sampleText = String(data.get("sampleSize") ?? "").trim();
    const sampleSize = /^\d{1,10}$/.test(sampleText) ? Number(sampleText) : Number.NaN;
    if (!Number.isInteger(sampleSize)) {
      setNotice("INVALID_INPUT");
      return;
    }
    inFlight.current = true;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: String(data.get("brandId") ?? ""),
          track: String(data.get("track") ?? "").trim(),
          sampleSize,
          grade: String(data.get("grade") ?? "").trim(),
          expiresAt: String(data.get("expiresAt") ?? "").trim(),
        }),
      });
      if (response.status === 401) {
        window.location.replace(loginPath(sharesPath, "session-required"));
        return;
      }
      if (!response.ok) {
        setNotice(errorFrom(await response.json()));
        return;
      }
      setNotice("saved");
      form.reset();
      router.refresh();
    } catch {
      setNotice("SERVICE_UNAVAILABLE");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} aria-labelledby="whitelabel-share-create" className="min-w-0 max-w-2xl space-y-4 rounded-xl border bg-card p-4">
      <h2 id="whitelabel-share-create" className="text-lg font-semibold">{t("createTitle")}</h2>
      <label className="block space-y-1 text-sm" htmlFor="whitelabel-share-brand">
        <span>{t("brand")}</span>
        <select id="whitelabel-share-brand" name="brandId" required className={fieldClass}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm" htmlFor="whitelabel-share-track">
        <span>{t("track")}</span>
        <Input id="whitelabel-share-track" name="track" required minLength={1} maxLength={64} autoComplete="off" spellCheck={false} placeholder="official_api" className="h-10" />
      </label>
      <div className="space-y-1 text-sm">
        <label htmlFor="whitelabel-share-sample">{t("sampleSize")}</label>
        <Input id="whitelabel-share-sample" name="sampleSize" required inputMode="numeric" aria-describedby="whitelabel-share-sample-help" autoComplete="off" className="h-10" />
        <p id="whitelabel-share-sample-help" className="text-muted-foreground">{t("sampleHint")}</p>
      </div>
      <label className="block space-y-1 text-sm" htmlFor="whitelabel-share-grade">
        <span>{t("grade")}</span>
        <Input id="whitelabel-share-grade" name="grade" required minLength={1} maxLength={32} autoComplete="off" spellCheck={false} placeholder="exploratory" className="h-10" />
      </label>
      <div className="space-y-1 text-sm">
        <label htmlFor="whitelabel-share-expires">{t("expiresAt")}</label>
        <Input id="whitelabel-share-expires" name="expiresAt" required minLength={24} maxLength={24} aria-describedby="whitelabel-share-expires-help" autoComplete="off" className="h-10" />
        <p id="whitelabel-share-expires-help" className="text-muted-foreground">{t("expiresHint")}</p>
      </div>
      <Button type="submit" aria-disabled={pending} className={actionClass}>{pending ? t("saving") : t("saveShare")}</Button>
      <ShareNotice notice={notice} t={t} />
    </form>
  );
}

function ShareTime({ value, locale }: { value: string; locale: Locale }) {
  const date = new Date(value);
  const label = Number.isNaN(date.getTime()) ? value : `${formatDateTime(locale, date, "UTC")} UTC`;
  return <time dateTime={value} title={value}>{label}</time>;
}

function ShareCard({ share, brandName, expired, locale, t }: {
  share: ShareView; brandName: string; expired: boolean; locale: Locale; t: Translator;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const revokedOnClose = useRef(false);
  const [pending, setPending] = useState<"view" | "revoke" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const revoked = share.revoked === 1 || notice === "revoked";
  const viewable = !revoked && !expired;
  const titleId = `whitelabel-share-${share.id}`;

  async function run(action: "view" | "revoke") {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(action);
    setNotice(null);
    try {
      const url = `${endpoint}/${share.id}${action === "revoke" ? "/revoke" : ""}`;
      const response = await fetch(url, { method: "POST" });
      if (response.status === 401) {
        window.location.replace(loginPath(sharesPath, "session-required"));
        return;
      }
      if (!response.ok) {
        setNotice(errorFrom(await response.json()));
        if (response.status === 404) router.refresh();
        return;
      }
      if (action === "view") {
        const preview = previewResponse.safeParse(await response.json());
        setNotice(preview.success ? preview.data.share : "SERVICE_UNAVAILABLE");
      } else {
        setNotice("revoked");
        revokedOnClose.current = true;
        setConfirming(false);
      }
      router.refresh();
    } catch {
      setNotice("SERVICE_UNAVAILABLE");
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  return (
    <article aria-labelledby={titleId} className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={titleId} ref={heading} tabIndex={-1} className="min-w-0 scroll-mt-20 rounded-sm font-semibold [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-ring">
          {brandName}
        </h3>
        <Badge variant={viewable ? "secondary" : "outline"}>{t(revoked ? "statusRevoked" : expired ? "statusExpired" : "statusActive")}</Badge>
      </div>
      <dl className="grid gap-3 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-2">
        <div><dt>{t("track")}</dt><dd className="font-medium [overflow-wrap:anywhere]"><bdi translate="no">{share.track}</bdi></dd></div>
        <div><dt>{t("sampleSize")}</dt><dd className="font-medium tabular-nums">{formatShareSample(share.sampleSize)}</dd></div>
        <div><dt>{t("grade")}</dt><dd className="font-medium [overflow-wrap:anywhere]"><bdi translate="no">{share.grade}</bdi></dd></div>
        <div><dt>{t("expiresAt")}</dt><dd><ShareTime value={share.expiresAt} locale={locale} /></dd></div>
        <div><dt>{t("createdAt")}</dt><dd><ShareTime value={share.createdAt} locale={locale} /></dd></div>
        <div>
          <dt>{t("accessCount")}</dt><dd className="font-medium tabular-nums">{formatShareSample(share.accesses.length)}</dd>
          {share.accesses.length > 0 && (
            <dd>
              <ul className="mt-1 space-y-1 text-muted-foreground">
                {share.accesses.map((access) => <li key={access.id}><ShareTime value={access.accessedAt} locale={locale} /></li>)}
              </ul>
            </dd>
          )}
        </div>
      </dl>
      <div className="flex flex-wrap gap-2 empty:hidden">
        {viewable && (
          <Button type="button" aria-disabled={pending !== null} className={actionClass} onClick={() => void run("view")}>
            {pending === "view" ? t("opening") : t("viewShare")}
          </Button>
        )}
        <Dialog open={confirming} onOpenChange={(open) => {
          if (inFlight.current) return;
          setNotice(null);
          setConfirming(open);
        }}>
          {!revoked && (
            <DialogTrigger asChild>
              <Button type="button" variant="outline" aria-disabled={pending !== null} className={actionClass}>{t("revokeShare")}</Button>
            </DialogTrigger>
          )}
          <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto" onCloseAutoFocus={(event) => {
            if (!revokedOnClose.current) return;
            event.preventDefault();
            heading.current?.focus();
          }}>
            <DialogHeader>
              <DialogTitle>{t("revokeShare")}</DialogTitle>
              <DialogDescription>{t("confirmDescription")}</DialogDescription>
            </DialogHeader>
            <ShareNotice notice={confirming ? notice : null} t={t} />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" aria-disabled={pending !== null} className={actionClass}>{t("cancel")}</Button>
              </DialogClose>
              <Button type="button" variant="destructive" aria-disabled={pending !== null} className={actionClass} onClick={() => void run("revoke")}>
                {pending === "revoke" ? t("revoking") : t("confirmRevoke")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <ShareNotice notice={!confirming && (viewable || typeof notice === "string") ? notice : null} t={t} />
    </article>
  );
}

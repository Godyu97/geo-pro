"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { formatShareSample, shareErrors, type ShareError, type ShareView, type ShareWorkspace } from "./share-contracts.ts";

type Copy = Messages["shares"];
type Translator = (key: keyof Copy) => string;

const fieldClass = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";
const sharesPath = "/dashboard/reports/shares";

function noticeFrom(payload: unknown, t: Translator) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return t("SERVICE_UNAVAILABLE");
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return t("SERVICE_UNAVAILABLE");
  return error.code in shareErrors ? t(error.code as ShareError) : t("SERVICE_UNAVAILABLE");
}

export function SharesPanel({ workspace, messages }: { workspace: ShareWorkspace; messages: Copy }) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const names = new Map(workspace.brands.map((brand) => [brand.id, brand.name]));
  return (
    <div className="min-w-0 space-y-6">
      {workspace.brands.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("noBrands")}</p> : <ShareForm t={t} brands={workspace.brands} />}
      <section className="space-y-3" aria-labelledby="whitelabel-shares-heading">
        <h2 id="whitelabel-shares-heading" className="text-base font-semibold">{t("myShares")}</h2>
        {workspace.shares.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("empty")}</p> : (
          <ul className="space-y-3">
            {workspace.shares.map((share) => (
              <ShareCard key={share.id} share={share} brandName={names.get(share.brandId) ?? share.brandId} t={t} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ShareForm({ brands, t }: { brands: ShareWorkspace["brands"]; t: Translator }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const sampleText = String(data.get("sampleSize") ?? "").trim();
    const sampleSize = /^\d{1,10}$/.test(sampleText) ? Number(sampleText) : Number.NaN;
    if (!Number.isInteger(sampleSize)) {
      setNotice(t("INVALID_INPUT"));
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/reports/shares", {
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
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath(sharesPath, "session-required"));
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
      <h2 className="text-base font-semibold">{t("createTitle")}</h2>
      <label className="block space-y-1 text-sm" htmlFor="whitelabel-share-brand">
        <span>{t("brand")}</span>
        <select id="whitelabel-share-brand" name="brandId" required className={fieldClass}>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm" htmlFor="whitelabel-share-track">
        <span>{t("track")}</span>
        <Input id="whitelabel-share-track" name="track" required minLength={1} maxLength={64} autoComplete="off" spellCheck={false} placeholder="official_api" />
      </label>
      <label className="block space-y-1 text-sm" htmlFor="whitelabel-share-sample">
        <span>{t("sampleSize")}</span>
        <Input id="whitelabel-share-sample" name="sampleSize" required inputMode="numeric" min={0} max={2000000000} step={1} autoComplete="off" />
        <span className="text-muted-foreground">{t("sampleHint")}</span>
      </label>
      <label className="block space-y-1 text-sm" htmlFor="whitelabel-share-grade">
        <span>{t("grade")}</span>
        <Input id="whitelabel-share-grade" name="grade" required minLength={1} maxLength={32} autoComplete="off" spellCheck={false} placeholder="exploratory" />
      </label>
      <label className="block space-y-1 text-sm" htmlFor="whitelabel-share-expires">
        <span>{t("expiresAt")}</span>
        <Input id="whitelabel-share-expires" name="expiresAt" required minLength={24} maxLength={24} autoComplete="off" spellCheck={false} placeholder="2026-12-31T00:00:00.000Z" />
        <span className="text-muted-foreground">{t("expiresHint")}</span>
      </label>
      <Button type="submit" disabled={pending}>{pending ? t("saving") : t("saveShare")}</Button>
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </form>
  );
}

function ShareCard({ share, brandName, t }: { share: ShareView; brandName: string; t: Translator }) {
  const router = useRouter();
  const [pending, setPending] = useState<"view" | "revoke" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function viewShare() {
    if (pending) return;
    setPending("view");
    setNotice(null);
    try {
      const response = await fetch(`/api/reports/shares/${share.id}`);
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath(sharesPath, "session-required"));
          return;
        }
        setNotice(noticeFrom(await response.json(), t));
        return;
      }
      const body: unknown = await response.json();
      const shareBody = body && typeof body === "object" && "share" in body ? body.share : null;
      const track = shareBody && typeof shareBody === "object" && "track" in shareBody && typeof shareBody.track === "string" ? shareBody.track : "";
      const grade = shareBody && typeof shareBody === "object" && "grade" in shareBody && typeof shareBody.grade === "string" ? shareBody.grade : "";
      const sample = shareBody && typeof shareBody === "object" && "sampleSize" in shareBody && typeof shareBody.sampleSize === "number"
        ? formatShareSample(shareBody.sampleSize)
        : "";
      setNotice(`${t("viewed")} ${track} · ${sample} · ${grade}`);
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(null);
    }
  }

  async function revokeShare() {
    if (pending) return;
    setPending("revoke");
    setNotice(null);
    try {
      const response = await fetch(`/api/reports/shares/${share.id}/revoke`, { method: "POST" });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath(sharesPath, "session-required"));
          return;
        }
        setNotice(noticeFrom(await response.json(), t));
        return;
      }
      setNotice(t("revoked"));
      router.refresh();
    } catch {
      setNotice(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(null);
    }
  }

  return (
    <li className="min-w-0 space-y-2 rounded-xl border p-5">
      <p className="text-sm font-medium">{share.revoked === 1 ? t("statusRevoked") : t("statusActive")}</p>
      <p className="text-sm">{t("track")} <bdi translate="no">{share.track}</bdi></p>
      <p className="text-sm">{t("sampleSize")} <bdi translate="no">{formatShareSample(share.sampleSize)}</bdi></p>
      <p className="text-sm">{t("grade")} <bdi translate="no">{share.grade}</bdi></p>
      <p className="break-all text-sm text-muted-foreground">{brandName}</p>
      <p className="text-sm text-muted-foreground">{t("expiresAt")} <time dateTime={share.expiresAt}>{share.expiresAt}</time></p>
      <p className="text-sm text-muted-foreground">{t("createdAt")} <time dateTime={share.createdAt}>{share.createdAt}</time></p>
      <p className="text-sm text-muted-foreground">{t("accessCount")} <bdi translate="no">{formatShareSample(share.accesses.length)}</bdi></p>
      {share.accesses.length > 0 && (
        <ul className="space-y-1">
          {share.accesses.map((access) => (
            <li key={access.id} className="break-all text-sm text-muted-foreground">
              <time dateTime={access.accessedAt}>{access.accessedAt}</time>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending !== null} onClick={viewShare}>{pending === "view" ? t("saving") : t("viewShare")}</Button>
        {share.revoked === 0 && (
          <Button type="button" variant="outline" disabled={pending !== null} onClick={revokeShare}>{pending === "revoke" ? t("saving") : t("revokeShare")}</Button>
        )}
      </div>
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </li>
  );
}

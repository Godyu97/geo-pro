"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import { formatDateTime } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { exportErrorMessage, exportFileName, exportScopes, type ExportErrorCode, type ExportScope, type ExportSummary } from "./contracts";

const descriptionKeys = {
  profile: "profileScope",
  brands: "brandScope",
  factsAndMaterials: "factsScope",
  monitoringAndEvidence: "monitoringScope",
  content: "contentScope",
  reports: "reportsScope",
  usageAndCosts: "usageScope",
} as const;

export function DataExportForm({ userId, messages, brandsAllowed, initialSummary }: {
  userId: string;
  messages: Messages["dataExports"];
  brandsAllowed: boolean;
  initialSummary: ExportSummary | null;
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const [selection, setSelection] = useState<ExportScope[]>(["profile"]);
  const [localResult, setLocalResult] = useState<{ initialId: string | null; summary: ExportSummary }>();
  const [pending, setPending] = useState<"prepare" | "download" | null>(null);
  const [error, setError] = useState<ExportErrorCode | null>(null);
  const initialId = initialSummary?.id ?? null;
  const summary = localResult?.initialId === initialId ? localResult.summary : initialSummary;
  const scopes = exportScopes.filter((scope) => selection.includes(scope) && (scope === "profile" || brandsAllowed));
  const canDownload = summary && summary.status !== "failed" && (brandsAllowed || summary.included.every((scope) => scope === "profile"));

  async function reportFailure(response: Response) {
    if (response.status === 401) {
      const { pathname, search } = window.location;
      window.location.replace(loginPath(`${pathname}${search}#data-management`, "session-required"));
      return;
    }
    const { error } = await response.json() as { error?: { code?: ExportErrorCode } };
    const code = error?.code;
    setError(code && Object.hasOwn(exportErrorMessage, code) ? code : "SERVICE_UNAVAILABLE");
  }

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !scopes.length) return;
    setPending("prepare");
    setError(null);
    try {
      const response = await fetch("/api/data-exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId: userId, previousId: summary?.id ?? null, scopes, locale }),
      });
      if (!response.ok) return await reportFailure(response);
      setLocalResult({ initialId, summary: await response.json() });
    } catch {
      setError("SERVICE_UNAVAILABLE");
    } finally {
      setPending(null);
    }
  }

  async function download() {
    if (pending || !canDownload) return;
    setPending("download");
    setError(null);
    try {
      const response = await fetch(`/api/data-exports/${summary.id}`, { cache: "no-store" });
      if (!response.ok) return await reportFailure(response);
      const href = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = href;
      link.download = exportFileName(summary);
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
    } catch {
      setError("SERVICE_UNAVAILABLE");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-3 text-sm leading-6">
      <form method="post" onSubmit={prepare} aria-busy={pending === "prepare"} className="space-y-3">
        <fieldset className="min-w-0 space-y-2">
          <legend className="font-medium">{t("chooseScope")}</legend>
          {exportScopes.map((scope) => (
            <div key={scope}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  disabled={scope !== "profile" && !brandsAllowed}
                  aria-describedby={`export-scope-${scope}`}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setSelection((current) => checked ? [...current, scope] : current.filter((item) => item !== scope));
                  }}
                  className="mt-1 size-4 shrink-0 rounded-sm accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
                <span>{t(scope)}</span>
              </label>
              <p id={`export-scope-${scope}`} className="ml-6 text-muted-foreground">
                {t(scope !== "profile" && !brandsAllowed ? "brandsClosed" : descriptionKeys[scope])}
              </p>
            </div>
          ))}
        </fieldset>
        <p className="text-muted-foreground">{t("unavailableScopes")}</p>
        <Button type="submit" disabled={!scopes.length} aria-disabled={Boolean(pending) || !scopes.length} className="min-h-10">
          {t(pending === "prepare" ? "preparing" : "prepare")}
        </Button>
      </form>

      <div className="space-y-2 border-t pt-3">
        <div role="status" className="space-y-1">
          <p className="font-medium">{t(pending === "prepare" ? "preparingStatus" : summary?.status ?? "empty")}</p>
          {summary && pending !== "prepare" && (
            <>
              <p className="text-muted-foreground">{t("generated", {
                time: formatDateTime(locale, new Date(summary.createdAt)),
                language: t(summary.locale === "zh-CN" ? "chinese" : "english"),
              })}</p>
              {summary.included.length > 0 && <p>{t("included", { scopes: new Intl.ListFormat(locale).format(summary.included.map((scope) => t(scope))) })}</p>}
              {summary.missing.length > 0 && <p>{t("missing", { scopes: new Intl.ListFormat(locale).format(summary.missing.map((scope) => t(scope))) })}</p>}
            </>
          )}
        </div>
        {canDownload && (
          <Button type="button" variant="outline" onClick={download} aria-disabled={Boolean(pending)} className="min-h-10">
            {t(pending === "download" ? "downloading" : "download")}
          </Button>
        )}
        {error && <p role="alert" className="text-destructive">{t(exportErrorMessage[error])}</p>}
        {(error === "CONFLICT" || error === "SESSION_CHANGED" || error === "SERVICE_UNAVAILABLE") && (
          <Button type="button" variant="outline" onClick={() => { setError(null); router.refresh(); }} className="min-h-10">
            {t("refresh")}
          </Button>
        )}
      </div>
    </div>
  );
}

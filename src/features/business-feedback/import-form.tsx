"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { leadEvidenceValues, leadRejectReasons, parseLeadLines } from "./contracts.ts";

type Copy = Messages["businessLeads"];
type Evidence = (typeof leadEvidenceValues)[number];
type Reason = (typeof leadRejectReasons)[number];

type ImportResult = {
  leads: { id: string; eventId: string; primary: Evidence; count: number; evidence: Evidence[] }[];
  rejected: { index: number; reason: Reason }[];
};

export function LeadImportForm({
  locale,
  messages,
  brandId,
  rowsId,
}: {
  locale: Locale;
  messages: Copy;
  brandId: string;
  rowsId: string;
}) {
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const [rows, setRows] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const evidenceLabel: Record<Evidence, string> = {
    referral: t("evidenceReferral"),
    self_report: t("evidenceSelfReport"),
    landing_page: t("evidenceLandingPage"),
    unknown: t("evidenceUnknown"),
  };
  const reasonLabel: Record<Reason, string> = {
    direct_pii: t("reasonDirectPii"),
    missing_id: t("reasonMissingId"),
  };

  async function submit() {
    if (pending) return;
    const parsed = parseLeadLines(rows);
    if ("error" in parsed) {
      setResult(null);
      setStatus(t("INVALID_INPUT"));
      return;
    }
    setPending(true);
    setStatus(null);
    setResult(null);
    try {
      const response = await fetch("/api/reports/leads", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brandId, rows: parsed.rows }),
      });
      const payload = await response.json() as ImportResult & { error?: { code?: keyof Copy; message?: string } };
      if (!response.ok) {
        const code = payload.error?.code;
        setStatus(code && code in messages ? t(code) : t("SERVICE_UNAVAILABLE"));
        return;
      }
      setResult({ leads: payload.leads, rejected: payload.rejected });
      setRows("");
      router.refresh();
    } catch {
      setStatus(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="min-w-0 rounded-2xl border bg-card p-5" onSubmit={(event) => {
      event.preventDefault();
      void submit();
    }}>
      <h2 className="text-lg font-semibold">{t("importTitle")}</h2>
      <div className="mt-4 space-y-2 text-sm">
        <label htmlFor={rowsId} className="block font-medium">{t("rows")}</label>
        <textarea
          id={rowsId}
          name="rows"
          value={rows}
          onChange={(event) => setRows(event.target.value)}
          required
          rows={6}
          spellCheck={false}
          aria-describedby={`${rowsId}-hint`}
          className="block w-full scroll-mt-8 rounded-lg border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
        <p id={`${rowsId}-hint`} className="text-muted-foreground">{t("rowsHint")}</p>
      </div>
      <Button type="submit" aria-disabled={pending} className="mt-4 min-h-10 aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
        {pending ? t("importing") : t("import")}
      </Button>
      {status ? <p role="alert" className="mt-4 rounded-xl border px-4 py-3 text-sm">{status}</p> : null}
      <div role="status" aria-atomic={false}>
        {result ? (
          <div className="mt-4 space-y-3">
            <h3 className="text-base font-semibold">{t("importedHeading")}</h3>
            {result.leads.length === 0 ? <p className="text-sm text-muted-foreground">{t("importedNone")}</p> : result.leads.map((lead) => (
              <article key={lead.id} className="space-y-1 rounded-xl border border-dashed p-4 text-sm [overflow-wrap:anywhere]">
                <p className="tabular-nums">{t("eventLine", { id: lead.eventId })}</p>
                <p>{t("countLine")}</p>
                <p>{t("primaryLine", { primary: evidenceLabel[lead.primary] })}</p>
                <p>{lead.evidence.map((category) => evidenceLabel[category]).join(" · ")}</p>
              </article>
            ))}
            {result.rejected.length > 0 ? (
              <div>
                <h3 className="text-base font-semibold">{t("rejectedHeading")}</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {result.rejected.map((row) => (
                    <li key={row.index}>{t("rejectedLine", { row: row.index + 1, reason: reasonLabel[row.reason] })}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";

type Copy = Messages["leadQuality"];
const inputClass = "h-10 w-full rounded-md border bg-background px-3 tabular-nums";

function checked(form: FormData, name: string) {
  return form.get(name) === "true";
}

function wholeNumber(value: FormDataEntryValue | null, allowEmpty: boolean) {
  const raw = String(value ?? "").trim();
  if (allowEmpty && raw.length === 0) return { value: null as number | null };
  if (!/^\d{1,10}$/.test(raw)) return { error: true as const };
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > 1_000_000_000) return { error: true as const };
  return { value: parsed };
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as { error?: { code?: keyof Copy } };
  return { ok: response.ok, code: payload.error?.code };
}

export function SaveLeadRuleForm({
  locale,
  messages,
  brandId,
}: {
  locale: Locale;
  messages: Copy;
  brandId: string;
}) {
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function submit(form: FormData) {
    setPending(true);
    setStatus(null);
    try {
      const result = await postJson("/api/reports/lead-rules", {
        brandId,
        requiresRealNeed: checked(form, "requiresRealNeed"),
        requiresIndustry: checked(form, "requiresIndustry"),
        requiresFollowUp: checked(form, "requiresFollowUp"),
      });
      if (!result.ok) {
        const code = result.code;
        setStatus(code && code in messages ? t(code) : t("SERVICE_UNAVAILABLE"));
        return;
      }
      setStatus(t("saved"));
      router.refresh();
    } catch {
      setStatus(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-4 rounded-2xl border p-5 sm:grid-cols-2" onSubmit={(event) => {
      event.preventDefault();
      void submit(new FormData(event.currentTarget));
    }}>
      <h2 className="text-lg font-semibold sm:col-span-2">{t("saveTitle")}</h2>
      <label className="flex items-center gap-2 text-sm">
        <input name="requiresRealNeed" type="checkbox" value="true" />
        <span>{t("realNeed")}</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="requiresIndustry" type="checkbox" value="true" />
        <span>{t("targetIndustry")}</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="requiresFollowUp" type="checkbox" value="true" />
        <span>{t("followUp")}</span>
      </label>
      <div className="flex items-center">
        <Button type="submit" disabled={pending}>{pending ? t("saving") : t("saveRule")}</Button>
      </div>
      {status ? <p role="alert" className="text-sm sm:col-span-2">{status}</p> : null}
    </form>
  );
}

export function LeadRuleActions({
  locale,
  messages,
  brandId,
  ruleId,
  frozen,
}: {
  locale: Locale;
  messages: Copy;
  brandId: string;
  ruleId: string;
  frozen: boolean;
}) {
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const [pending, setPending] = useState<"freeze" | "qualify" | null>(null);
  const [frozenNow, setFrozenNow] = useState(frozen);
  const [status, setStatus] = useState<string | null>(null);

  async function finish(result: { ok: boolean; code?: keyof Copy }, frozenAfter: boolean) {
    if (!result.ok) {
      const code = result.code;
      setStatus(code && code in messages ? t(code) : t("SERVICE_UNAVAILABLE"));
      return;
    }
    if (frozenAfter) setFrozenNow(true);
    setStatus(t("saved"));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {frozenNow ? null : (
        <Button type="button" variant="outline" disabled={pending !== null} onClick={() => {
          setPending("freeze");
          setStatus(null);
          void postJson(`/api/reports/lead-rules/${ruleId}/freeze`, {})
            .then((result) => finish(result, true))
            .catch(() => setStatus(t("SERVICE_UNAVAILABLE")))
            .finally(() => setPending(null));
        }}>{pending === "freeze" ? t("freezing") : t("freeze")}</Button>
      )}
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending("qualify");
        setStatus(null);
        void postJson("/api/reports/lead-rules", {
          brandId,
          ruleId,
          realNeed: checked(form, "realNeed"),
          targetIndustry: checked(form, "targetIndustry"),
          followUp: checked(form, "followUp"),
        }).then((result) => finish(result, false))
          .catch(() => setStatus(t("SERVICE_UNAVAILABLE")))
          .finally(() => setPending(null));
      }}>
        <h3 className="text-base font-semibold sm:col-span-2">{t("qualifyTitle")}</h3>
        <label className="flex items-center gap-2 text-sm">
          <input name="realNeed" type="checkbox" value="true" />
          <span>{t("realNeed")}</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input name="targetIndustry" type="checkbox" value="true" />
          <span>{t("targetIndustry")}</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input name="followUp" type="checkbox" value="true" />
          <span>{t("followUp")}</span>
        </label>
        <div>
          <Button type="submit" disabled={pending !== null}>{pending === "qualify" ? t("qualifying") : t("qualify")}</Button>
        </div>
      </form>
      {status ? <p role="alert" className="text-sm">{status}</p> : null}
    </div>
  );
}

export function LeadObservationForm({
  locale,
  messages,
  brandId,
}: {
  locale: Locale;
  messages: Copy;
  brandId: string;
}) {
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function submit(form: FormData) {
    const identifiedReferrals = wholeNumber(form.get("identifiedReferrals"), false);
    const sessionDenominator = wholeNumber(form.get("sessionDenominator"), true);
    const selfReported = wholeNumber(form.get("selfReported"), false);
    const crawlerVisits = wholeNumber(form.get("crawlerVisits"), false);
    const answerCitations = wholeNumber(form.get("answerCitations"), false);
    if (
      "error" in identifiedReferrals || "error" in sessionDenominator || "error" in selfReported
      || "error" in crawlerVisits || "error" in answerCitations
    ) {
      setStatus(t("INVALID_INPUT"));
      return;
    }
    setPending(true);
    setStatus(null);
    try {
      const result = await postJson("/api/reports/lead-observations", {
        brandId,
        identifiedReferrals: identifiedReferrals.value,
        sessionDenominator: sessionDenominator.value,
        selfReported: selfReported.value,
        crawlerVisits: crawlerVisits.value,
        answerCitations: answerCitations.value,
      });
      if (!result.ok) {
        const code = result.code;
        setStatus(code && code in messages ? t(code) : t("SERVICE_UNAVAILABLE"));
        return;
      }
      setStatus(t("saved"));
      router.refresh();
    } catch {
      setStatus(t("SERVICE_UNAVAILABLE"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-4 rounded-2xl border p-5 sm:grid-cols-2" onSubmit={(event) => {
      event.preventDefault();
      void submit(new FormData(event.currentTarget));
    }}>
      <h2 className="text-lg font-semibold sm:col-span-2">{t("observationTitle")}</h2>
      <label className="space-y-2 text-sm">
        <span>{t("identifiedReferrals")}</span>
        <input name="identifiedReferrals" type="number" required min={0} max={1000000000} step={1} inputMode="numeric" className={inputClass} />
      </label>
      <label className="space-y-2 text-sm">
        <span>{t("sessionDenominator")}</span>
        <input name="sessionDenominator" type="number" min={0} max={1000000000} step={1} inputMode="numeric" className={inputClass} />
        <span className="block text-muted-foreground">{t("sessionDenominatorHint")}</span>
      </label>
      <label className="space-y-2 text-sm">
        <span>{t("selfReported")}</span>
        <input name="selfReported" type="number" required min={0} max={1000000000} step={1} inputMode="numeric" className={inputClass} />
        <span className="block text-muted-foreground">{t("selfReportedHint")}</span>
      </label>
      <label className="space-y-2 text-sm">
        <span>{t("crawlerVisits")}</span>
        <input name="crawlerVisits" type="number" required min={0} max={1000000000} step={1} inputMode="numeric" className={inputClass} />
      </label>
      <label className="space-y-2 text-sm">
        <span>{t("answerCitations")}</span>
        <input name="answerCitations" type="number" required min={0} max={1000000000} step={1} inputMode="numeric" className={inputClass} />
      </label>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>{pending ? t("saving") : t("saveObservation")}</Button>
      </div>
      {status ? <p role="alert" className="text-sm sm:col-span-2">{status}</p> : null}
    </form>
  );
}

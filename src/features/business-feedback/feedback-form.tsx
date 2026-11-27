"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { followUpOutcomes } from "./feedback-contracts";
import type { LeadFeedback } from "./feedback-dao";

const selectClass = "w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring";

function criterion(form: FormData, key: string) {
  const value = form.get(key);
  return value === "1" ? true : value === "0" ? false : null;
}

export function LeadFeedbackForm({ brandId, leadId, current, rules, locale, messages }: {
  brandId: string;
  leadId: string;
  current: LeadFeedback | null;
  rules: { id: string; version: number }[];
  locale: Locale;
  messages: Messages["businessLeads"];
}) {
  const router = useRouter();
  const baseId = useId();
  const t = createTranslator(locale, messages);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "FEEDBACK_CHANGED" | "RULE_NOT_FROZEN" | "NOT_FOUND" | "SERVICE_UNAVAILABLE">("idle");

  async function save(form: FormData) {
    if (state === "saving") return;
    setState("saving");
    try {
      const response = await fetch("/api/reports/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          leadId,
          ruleId: form.get("ruleId"),
          expectedRevision: current?.revision ?? 0,
          realNeed: criterion(form, "realNeed"),
          targetIndustry: criterion(form, "targetIndustry"),
          canFollowUp: criterion(form, "canFollowUp"),
          outcome: form.get("outcome"),
        }),
      });
      if (!response.ok) {
        const { error } = await response.json();
        const code = error?.code;
        setState(code === "FEEDBACK_CHANGED" || code === "RULE_NOT_FROZEN" || code === "NOT_FOUND"
          ? code : "SERVICE_UNAVAILABLE");
        return;
      }
      setState("saved");
      router.refresh();
    } catch {
      setState("SERVICE_UNAVAILABLE");
    }
  }

  return (
    <form key={current?.revision} aria-label={t("feedbackEdit")} className="grid gap-3 border-t pt-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save(new FormData(event.currentTarget));
      }}>
      <div className="min-w-0 space-y-1 text-sm">
        <label htmlFor={`${baseId}-ruleId`} className="block">{t("feedbackRule")}</label>
        <select id={`${baseId}-ruleId`} name="ruleId" defaultValue={current?.ruleId ?? rules[0]?.id} className={selectClass} required>
          {rules.map((rule) => <option key={rule.id} value={rule.id}>{t("feedbackRuleVersion", { version: rule.version })}</option>)}
        </select>
      </div>
      {([
        ["realNeed", "feedbackNeed"],
        ["targetIndustry", "feedbackIndustry"],
        ["canFollowUp", "feedbackCanFollowUp"],
      ] as const).map(([key, label]) => (
        <div key={key} className="min-w-0 space-y-1 text-sm">
          <label htmlFor={`${baseId}-${key}`} className="block">{t(label)}</label>
          <select id={`${baseId}-${key}`} name={key} defaultValue={current?.[key] ?? ""} className={selectClass}>
            <option value="">{t("feedbackUnknown")}</option>
            <option value="1">{t("feedbackYes")}</option>
            <option value="0">{t("feedbackNo")}</option>
          </select>
        </div>
      ))}
      <div className="min-w-0 space-y-1 text-sm">
        <label htmlFor={`${baseId}-outcome`} className="block">{t("feedbackOutcome")}</label>
        <select id={`${baseId}-outcome`} name="outcome" defaultValue={current?.outcome ?? "unknown"} className={selectClass}>
          {followUpOutcomes.map((outcome) => <option key={outcome} value={outcome}>{t(`outcome_${outcome}`)}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={state === "saving" || state === "FEEDBACK_CHANGED"} className="h-auto min-h-10 whitespace-normal">
          {t(state === "saving" ? "feedbackSaving" : "feedbackSave")}
        </Button>
        {state === "saved" ? <p role="status" className="text-sm">{t("feedbackSaved")}</p> : null}
        {state !== "idle" && state !== "saving" && state !== "saved" ? (
          <p role="alert" className="text-sm">{t(state)}</p>
        ) : null}
      </div>
    </form>
  );
}

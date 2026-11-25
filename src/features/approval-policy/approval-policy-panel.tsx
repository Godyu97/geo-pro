"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { approvalErrors, type ApprovalDutyView, type ApprovalError, type ApprovalPolicyView } from "./contracts.ts";

export function ApprovalPolicyPanel({ labels, policies, messages }: {
  labels: { brandId: string; name: string }[];
  policies: ApprovalPolicyView[];
  messages: Messages["approvalPolicy"];
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const labelFor = (brandId: string) => labels.find((label) => label.brandId === brandId)?.name ?? brandId;

  if (policies.length === 0) return <p className="rounded-xl border border-dashed bg-card p-4 text-sm leading-6 text-muted-foreground">{t("noBrands")}</p>;

  return (
    <section id="approval-policies" tabIndex={-1} aria-label={t("viewPolicies")}
      className="min-w-0 scroll-mt-5 space-y-6 rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("historicalNote")}</p>
      {policies.map((policy) => (
        <PolicyForm key={`${policy.brandId}:${policy.version}`} label={labelFor(policy.brandId)} policy={policy} t={t} />
      ))}
    </section>
  );
}

function PolicyForm({ label, policy, t }: {
  label: string;
  policy: ApprovalPolicyView;
  t: (key: keyof Messages["approvalPolicy"]) => string;
}) {
  const router = useRouter();
  const [dualControl, setDualControl] = useState(policy.dualControl);
  const [duties, setDuties] = useState<ApprovalDutyView[]>(policy.duties);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const userId = String(form.get("userId") ?? "").trim();
    const next = userId ? [...duties, {
      userId,
      factApprover: form.get("factApprover") === "on",
      contentApprover: form.get("contentApprover") === "on",
    }] : duties;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/approval-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: policy.brandId, dualControl, duties: next }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath("/dashboard/settings/approval-policy", "session-required"));
          return;
        }
        const body = await response.json() as { error?: { code?: ApprovalError } };
        const code = body.error?.code;
        setNotice(code && code in approvalErrors ? t(code) : t("SERVICE_UNAVAILABLE"));
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
    <form onSubmit={save} className="min-w-0 space-y-4 rounded-xl border bg-card p-5">
      <div className="space-y-1">
        <h2 className="font-medium wrap-anywhere">{label}</h2>
        <p className="text-sm text-muted-foreground">{t("version")}: {policy.version}</p>
      </div>
      {notice && <p role="status" className="text-sm leading-6">{notice}</p>}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={dualControl} onChange={(event) => setDualControl(event.target.checked)} />
        <span>
          <span className="font-medium">{t("dualControl")}</span>
          <span className="block text-muted-foreground">{t("dualControlHint")}</span>
        </span>
      </label>
      <ul className="space-y-2 text-sm">
        {duties.length === 0 ? <li className="text-muted-foreground">{t("empty")}</li> : duties.map((duty) => (
          <li key={duty.userId} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 wrap-anywhere">{duty.userId}</span>
            <span className="text-muted-foreground">{duty.factApprover ? t("factApprover") : t("factClosed")}</span>
            <span className="text-muted-foreground">{duty.contentApprover ? t("contentApprover") : t("contentClosed")}</span>
            <Button type="button" variant="outline" onClick={() => setDuties(duties.filter((item) => item.userId !== duty.userId))}>
              {t("removeDuty")}
            </Button>
          </li>
        ))}
      </ul>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="font-medium">{t("memberUser")}</span>
          <Input name="userId" autoComplete="off" spellCheck={false} maxLength={128} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="factApprover" />
          <span>{t("factApprover")}</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="contentApprover" />
          <span>{t("contentApprover")}</span>
        </label>
      </div>
      <Button type="submit" disabled={pending}>{pending ? t("saving") : t("save")}</Button>
    </form>
  );
}

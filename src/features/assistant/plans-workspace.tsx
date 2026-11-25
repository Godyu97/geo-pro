"use client";

import { useId, useRef, useState, useTransition, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginPath } from "@/lib/auth/return-to";
import { formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import {
  assistantErrors,
  confirmAssistantPlanSchema,
  createAssistantPlanSchema,
  type AssistantError,
  type AssistantPlanView,
} from "./contracts";

type Copy = Messages["assistant"];
type Notice = { kind: "status" | "alert"; text: string };
type Slot = { action: string; fact: string };

const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center aria-disabled:opacity-60";
const wrapBadgeClass = "h-auto max-w-full whitespace-normal rounded-xl px-3 py-1 text-left leading-5 [overflow-wrap:anywhere]";
const textClass = "min-h-28 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const checkboxClass = "mt-0.5 size-4 shrink-0 rounded border border-input accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const emptySurfaceClass = "rounded-xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground";
const currentPath = "/dashboard/assistant";

const itemStatusKey = {
  draft: "statusDraft",
  confirmed: "statusConfirmed",
  executed: "statusExecuted",
  blocked: "statusBlocked",
} as const;

export function AssistantJump({ href, children, onClick, ...props }: ComponentProps<"a"> & { href: string; children: ReactNode }) {
  return (
    <a {...props} href={href} onClick={(event) => {
      onClick?.(event);
      const root = document.getElementById("main-content") ?? document;
      const target = root.querySelector<HTMLElement>(href);
      if (!target) return;
      event.preventDefault();
      target.focus();
      target.scrollIntoView({ block: "nearest" });
    }}>{children}</a>
  );
}

function isKnownError(code: string): code is AssistantError {
  return Object.hasOwn(assistantErrors, code);
}

function NoticeBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <p
      role={notice.kind}
      className={notice.kind === "alert"
        ? "rounded-xl border border-destructive/30 bg-card px-4 py-3 text-sm leading-6 text-destructive"
        : "rounded-xl border bg-card px-4 py-3 text-sm leading-6 text-foreground"}
    >
      {notice.text}
    </p>
  );
}

function emptySlots(): Slot[] {
  return Array.from({ length: 5 }, () => ({ action: "", fact: "" }));
}

export function PlansWorkspace({
  brandId,
  locale,
  initialPlans,
  messages,
  initialError,
}: {
  brandId: string;
  locale: Locale;
  initialPlans: AssistantPlanView[];
  messages: Copy;
  initialError: AssistantError | null;
}) {
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const formId = useId();
  const [plans, setPlans] = useState(initialPlans);
  const [material, setMaterial] = useState("");
  const [budget, setBudget] = useState("");
  const [successes, setSuccesses] = useState("");
  const [slots, setSlots] = useState<Slot[]>(emptySlots);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<Notice | null>(
    initialError ? { kind: "alert", text: t(initialError) } : null,
  );
  const [pending, setPending] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const inFlightRef = useRef(false);

  function replacePlan(plan: AssistantPlanView) {
    setPlans((current) => {
      const rest = current.filter((item) => item.id !== plan.id);
      return [plan, ...rest];
    });
  }

  async function submit(path: string, body: unknown, onSuccess: (plan: AssistantPlanView) => void) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null) as
      | { plan?: AssistantPlanView; error?: { code?: string } }
      | null;
    if (!response.ok) {
      const code = payload && "error" in payload ? payload.error?.code : undefined;
      if (response.status === 401 || code === "SESSION_REQUIRED") {
        router.push(loginPath(currentPath, "session-required"));
        return;
      }
      setNotice({
        kind: "alert",
        text: typeof code === "string" && isKnownError(code) ? t(code) : t("SERVICE_UNAVAILABLE"),
      });
      return;
    }
    if (!payload?.plan) {
      setNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
      return;
    }
    onSuccess(payload.plan);
    router.refresh();
  }

  function begin(key: string) {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    setPending(key);
    setNotice(null);
    return true;
  }

  function finish() {
    inFlightRef.current = false;
    setPending(null);
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlightRef.current) return;
    const items = slots.flatMap((slot) => {
      const action = slot.action.trim();
      const factVersionId = slot.fact.trim();
      if (!action && !factVersionId) return [];
      return [{ action, factVersionId }];
    });
    const command = createAssistantPlanSchema.safeParse({
      brandId,
      material,
      budgetMinor: Number(budget),
      successes: Number(successes),
      items,
    });
    if (!command.success) {
      setNotice({ kind: "alert", text: t("INVALID_INPUT") });
      return;
    }
    if (!begin("create")) return;
    startTransition(async () => {
      try {
        await submit("/api/assistant/plans", command.data, (plan) => {
          replacePlan(plan);
          setMaterial("");
          setBudget("");
          setSuccesses("");
          setSlots(emptySlots());
          setNotice({ kind: "status", text: t("saved") });
        });
      } catch {
        setNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
      } finally {
        finish();
      }
    });
  }

  function handleConfirm(event: FormEvent<HTMLFormElement>, planId: string) {
    event.preventDefault();
    if (inFlightRef.current) return;
    const itemIds = Object.entries(selected).filter(([, checked]) => checked).map(([id]) => id);
    const command = confirmAssistantPlanSchema.safeParse({ itemIds });
    if (!command.success) {
      setNotice({ kind: "alert", text: t("INVALID_INPUT") });
      return;
    }
    if (!begin(`confirm:${planId}`)) return;
    startTransition(async () => {
      try {
        await submit(`/api/assistant/plans/${planId}/confirm`, command.data, (plan) => {
          replacePlan(plan);
          setSelected({});
          setNotice({ kind: "status", text: t("confirmedNotice") });
        });
      } catch {
        setNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
      } finally {
        finish();
      }
    });
  }

  function handleExecute(event: FormEvent<HTMLFormElement>, planId: string) {
    event.preventDefault();
    if (inFlightRef.current) return;
    if (!begin(`execute:${planId}`)) return;
    startTransition(async () => {
      try {
        await submit(`/api/assistant/plans/${planId}/execute`, {}, (plan) => {
          replacePlan(plan);
          setNotice({ kind: "status", text: t("executedNotice") });
        });
      } catch {
        setNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
      } finally {
        finish();
      }
    });
  }

  return (
    <div className="min-w-0 space-y-6">
      <NoticeBanner notice={notice} />
      <Card id="assistant-create" className="min-w-0 scroll-mt-24">
        <CardHeader>
          <CardTitle>
            <h2 className="[overflow-wrap:anywhere]">{t("createTitle")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid min-w-0 gap-4 sm:grid-cols-2">
            <input type="hidden" name="brandId" value={brandId} />
            <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
              <Label htmlFor="assistant-material">{t("material")}</Label>
              <textarea
                id="assistant-material"
                value={material}
                maxLength={4000}
                onChange={(event) => setMaterial(event.target.value)}
                className={textClass}
              />
              <p className="text-sm leading-6 text-muted-foreground">{t("materialHint")}</p>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor={`${formId}-budget`}>{t("budget")}</Label>
              <Input
                id={`${formId}-budget`}
                value={budget}
                inputMode="numeric"
                maxLength={10}
                onChange={(event) => setBudget(event.target.value)}
                className="h-10 bg-background tabular-nums"
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor={`${formId}-successes`}>{t("successes")}</Label>
              <Input
                id={`${formId}-successes`}
                value={successes}
                inputMode="numeric"
                maxLength={7}
                onChange={(event) => setSuccesses(event.target.value)}
                className="h-10 bg-background tabular-nums"
              />
            </div>
            {slots.map((slot, index) => {
              const position = index + 1;
              return (
                <div key={position} className="grid min-w-0 gap-4 sm:col-span-2 sm:grid-cols-2">
                  <div className="flex min-w-0 flex-col gap-2">
                    <Label htmlFor={`${formId}-action-${position}`}>{t("action", { index: position })}</Label>
                    <Input
                      id={`${formId}-action-${position}`}
                      value={slot.action}
                      maxLength={200}
                      onChange={(event) => setSlots((current) => current.map((item, itemIndex) => (
                        itemIndex === index ? { ...item, action: event.target.value } : item
                      )))}
                      className="h-10 bg-background"
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <Label htmlFor={`${formId}-fact-${position}`}>{t("factVersion", { index: position })}</Label>
                    <Input
                      id={`${formId}-fact-${position}`}
                      value={slot.fact}
                      maxLength={36}
                      onChange={(event) => setSlots((current) => current.map((item, itemIndex) => (
                        itemIndex === index ? { ...item, fact: event.target.value } : item
                      )))}
                      className="h-10 bg-background"
                    />
                  </div>
                </div>
              );
            })}
            <div className="sm:col-span-2">
              <Button type="submit" aria-disabled={pending === "create"} className={actionClass}>
                {pending === "create" ? t("saving") : t("create")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {plans.length === 0 ? (
        <p className={emptySurfaceClass}>{t("empty")}</p>
      ) : (
        <div id="assistant-plans" tabIndex={-1} className="min-w-0 scroll-mt-24 space-y-4 outline-none focus-visible:outline-2 focus-visible:outline-ring">
          {plans.map((plan) => {
            const confirming = pending === `confirm:${plan.id}`;
            const executing = pending === `execute:${plan.id}`;
            const draftItems = plan.items.filter((item) => item.status === "draft");
            return (
              <Card key={plan.id} className="min-w-0">
                <CardHeader>
                  <CardTitle>
                    <h2 className="[overflow-wrap:anywhere]">{t("planHeading", { count: plan.items.length })}</h2>
                  </CardTitle>
                  <div className="flex min-w-0 flex-wrap gap-2">
                    <Badge variant="secondary" className={wrapBadgeClass}>
                      {plan.status === "settled" ? t("planSettled") : t("planDraft")}
                    </Badge>
                    <Badge variant="outline" className={wrapBadgeClass}>{t("strategyObservation")}</Badge>
                    <Badge variant="outline" className={wrapBadgeClass}>{t("strategyNotGuaranteed")}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm tabular-nums">{t("budgetLine", { amount: formatNumber(locale, plan.budgetMinor) })}</p>
                  <p className="text-sm tabular-nums">{t("successLine", { count: formatNumber(locale, plan.strategy.successes) })}</p>
                  {plan.ignored ? <p className="text-sm leading-6">{t("ignored")}</p> : null}
                  {draftItems.length > 0 ? (
                    <form onSubmit={(event) => handleConfirm(event, plan.id)} className="space-y-3">
                      <ul className="space-y-3">
                        {plan.items.map((item) => (
                          <li key={item.id} className="min-w-0 rounded-xl border border-dashed p-4">
                            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                              <p className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{item.action}</p>
                              <Badge variant="outline" className={wrapBadgeClass}>{t(itemStatusKey[item.status])}</Badge>
                            </div>
                            {item.status === "blocked" && item.blockReason === "fact_stale" ? (
                              <p className="mt-2 text-sm leading-6">{t("blockFactStale")}</p>
                            ) : null}
                            {item.status === "draft" ? (
                              <label className="mt-3 flex min-w-0 items-start gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  className={checkboxClass}
                                  checked={selected[item.id] === true}
                                  onChange={(event) => setSelected((current) => ({ ...current, [item.id]: event.target.checked }))}
                                />
                                <span>{t("selectItem")}</span>
                              </label>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      <Button type="submit" aria-disabled={confirming} className={actionClass}>
                        {confirming ? t("saving") : t("confirm")}
                      </Button>
                    </form>
                  ) : (
                    <ul className="space-y-3">
                      {plan.items.map((item) => (
                        <li key={item.id} className="min-w-0 rounded-xl border border-dashed p-4">
                          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                            <p className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{item.action}</p>
                            <Badge variant="outline" className={wrapBadgeClass}>{t(itemStatusKey[item.status])}</Badge>
                          </div>
                          {item.status === "blocked" && item.blockReason === "fact_stale" ? (
                            <p className="mt-2 text-sm leading-6">{t("blockFactStale")}</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  {plan.status === "draft" ? (
                    <form onSubmit={(event) => handleExecute(event, plan.id)}>
                      <Button type="submit" variant="outline" aria-disabled={executing} className={actionClass}>
                        {executing ? t("saving") : t("execute")}
                      </Button>
                    </form>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

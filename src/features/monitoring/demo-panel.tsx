"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import {
  createDemoObservationSchema,
  demoErrors,
  type CreateDemoObservationInput,
  type DemoError,
} from "./demo-contracts.ts";

type Copy = Messages["demoObservations"];

const fieldClass = "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm aria-invalid:border-destructive";
const returnPath = "/dashboard/monitoring/demo";

function errorFrom(payload: unknown): DemoError {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = payload.error;
    if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && Object.hasOwn(demoErrors, error.code)) {
      return error.code as DemoError;
    }
  }
  return "SERVICE_UNAVAILABLE";
}

export function DemoObservationForm({ brandId, brandName, messages }: { brandId: string; brandName: string; messages: Copy }) {
  const router = useRouter();
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<DemoError | "saved" | null>(null);
  const [invalidField, setInvalidField] = useState<"questionText" | "answerText" | null>(null);
  const inFlight = useRef(false);
  const attempt = useRef<CreateDemoObservationInput | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const questionText = String(data.get("questionText") ?? "").trim();
    const answerText = String(data.get("answerText") ?? "").trim();
    const previous = attempt.current;
    const operationId = previous?.questionText === questionText && previous.answerText === answerText
      ? previous.operationId
      : crypto.randomUUID();
    const parsed = createDemoObservationSchema.safeParse({ operationId, brandId, questionText, answerText });
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      if (field === "questionText" || field === "answerText") {
        setInvalidField(field);
        const control = form.elements.namedItem(field);
        if (control instanceof HTMLTextAreaElement) control.focus();
      }
      setNotice("INVALID_INPUT");
      return;
    }
    inFlight.current = true;
    attempt.current = parsed.data;
    setPending(true);
    setNotice(null);
    setInvalidField(null);
    try {
      const response = await fetch("/api/monitoring/demo-observations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.replace(loginPath(`${returnPath}?brandId=${brandId}`, "session-required"));
          return;
        }
        setNotice(errorFrom(await response.json()));
        return;
      }
      const saved = await response.json();
      if (!saved || typeof saved !== "object" || !("observation" in saved) || !saved.observation || saved.observation.is_demo !== true) {
        setNotice("SERVICE_UNAVAILABLE");
        return;
      }
      attempt.current = null;
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
    <form aria-labelledby="demo-observation-form-heading" noValidate onSubmit={submit} className="min-w-0 space-y-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="demo-observation-form-heading" className="text-lg font-semibold">{t("registerTitle")}</h2>
        <Badge variant="outline">{t("demoBadge")}</Badge>
      </div>
      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{brandName}</p>
      <p className="text-sm leading-6 text-muted-foreground">{t("fixtureNote")}</p>
      {notice && (
        <p id="demo-observation-feedback" role={notice === "saved" ? "status" : "alert"} className={notice === "saved" ? "text-sm leading-6" : "text-sm leading-6 text-destructive"}>
          {t(notice)}
        </p>
      )}
      <label className="block min-w-0 space-y-1 text-sm" htmlFor="demo-observation-question">
        <span>{t("question")}</span>
        <textarea id="demo-observation-question" className={fieldClass} name="questionText" required maxLength={4000} rows={3} readOnly={pending}
          aria-invalid={invalidField === "questionText"} aria-describedby={invalidField === "questionText" ? "demo-observation-feedback" : undefined} />
      </label>
      <label className="block min-w-0 space-y-1 text-sm" htmlFor="demo-observation-answer">
        <span>{t("answer")}</span>
        <textarea id="demo-observation-answer" className={fieldClass} name="answerText" required maxLength={8000} rows={4} readOnly={pending}
          aria-invalid={invalidField === "answerText"} aria-describedby={invalidField === "answerText" ? "demo-observation-feedback" : undefined} />
      </label>
      <Button type="submit" aria-disabled={pending} className="h-auto min-h-10 max-w-full whitespace-normal py-2 aria-disabled:opacity-50">
        {pending ? t("registering") : t("registerAction")}
      </Button>
    </form>
  );
}

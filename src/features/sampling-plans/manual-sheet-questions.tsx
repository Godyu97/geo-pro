"use client";

import { useState } from "react";
import { formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { manualSheetQuestionLimit } from "./rules";

type Version = { id: string; version: number; questions: { id: string; text: string }[] };
type Copy = Pick<Messages["samplingPlans"],
  "promptSetVersion" | "promptSetOption" | "manualSheetQuestions" | "manualSheetSelection" | "manualSheetNoQuestions">;

export function ManualSheetQuestions({ versions, locale, messages, fieldClass }: {
  versions: Version[];
  locale: Locale;
  messages: Copy;
  fieldClass: string;
}) {
  const t = createTranslator(locale, messages);
  const [versionId, setVersionId] = useState(versions[0]?.id ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const version = versions.find((item) => item.id === versionId);

  return (
    <div className="min-w-0 space-y-3 sm:col-span-2">
      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">{t("promptSetVersion")}</span>
        <select name="promptSetId" value={versionId} className={fieldClass} onChange={(event) => {
          setVersionId(event.target.value);
          setSelected([]);
        }}>
          {versions.map((item) => (
            <option key={item.id} value={item.id}>
              {t("promptSetOption", { version: formatNumber(locale, item.version), id: item.id })}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-medium">{t("manualSheetQuestions")}</legend>
        {version?.questions.length ? (
          <>
            <p role="status" className="text-xs text-muted-foreground">
              {t("manualSheetSelection", {
                count: formatNumber(locale, selected.length),
                limit: formatNumber(locale, manualSheetQuestionLimit),
              })}
            </p>
            <div className="space-y-1">
              {version.questions.map((question) => {
                const checked = selected.includes(question.id);
                return (
                  <label key={question.id} className="flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 text-sm has-checked:bg-muted/60">
                    <input type="checkbox" checked={checked} disabled={!checked && selected.length >= manualSheetQuestionLimit}
                      className="mt-1 size-4 shrink-0 accent-primary focus-visible:ring-2 focus-visible:ring-ring"
                      onChange={(event) => {
                        const checkedNow = event.target.checked;
                        setSelected((previous) => checkedNow
                          ? [...previous, question.id]
                          : previous.filter((id) => id !== question.id));
                      }} />
                    <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{question.text}</span>
                  </label>
                );
              })}
            </div>
          </>
        ) : <p className="text-sm text-muted-foreground">{t("manualSheetNoQuestions")}</p>}
        <input type="hidden" name="promptIds" value={selected.join(" ")} />
      </fieldset>
    </div>
  );
}

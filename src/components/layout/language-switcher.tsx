"use client";

import { useId, useState, useTransition } from "react";
import { setLocale } from "@/lib/i18n/actions";
import { useLocale } from "@/lib/i18n/client";

export function LanguageSwitcher() {
  const { locale, t } = useLocale();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex min-w-0 flex-col items-end gap-1">
      <label htmlFor={id} className="sr-only">{t("language")}</label>
      <select
        id={id}
        value={locale}
        aria-disabled={pending}
        aria-busy={pending}
        className="h-9 max-w-full rounded-lg border bg-card px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onChange={(event) => {
          if (pending) return;
          const value = event.target.value;
          setFailed(false);
          startTransition(async () => {
            try {
              setFailed(!(await setLocale(value)));
            } catch {
              setFailed(true);
            }
          });
        }}
      >
        <option value="zh-CN" lang="zh-CN">简体中文</option>
        <option value="en" lang="en">English</option>
      </select>
      {failed && <p role="alert" className="max-w-56 text-xs text-destructive">{t("languageFailed")}</p>}
    </div>
  );
}

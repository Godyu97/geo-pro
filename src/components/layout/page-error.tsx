"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useLocale } from "@/lib/i18n/client";

export function PageError({ reset, embedded = false }: { reset: () => void; embedded?: boolean }) {
  const { t } = useLocale();
  const Container = embedded ? "section" : "main";
  return (
    <Container id={embedded ? undefined : "main-content"} className="flex min-h-[60vh] flex-col items-center justify-center gap-5 p-6 text-center">
      <title>{t("errorTitle")} · GeoPro</title>
      <LanguageSwitcher />
      <h1 className="text-xl font-semibold">{t("errorTitle")}</h1>
      <p className="max-w-lg text-sm text-muted-foreground">{t("errorDescription")}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>{t("retry")}</Button>
        <Button asChild variant="outline"><Link href="/login">{t("backLogin")}</Link></Button>
      </div>
    </Container>
  );
}

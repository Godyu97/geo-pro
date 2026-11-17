import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { getTranslator } from "@/lib/i18n/server";
import Link from "next/link";

export default async function NotFound() {
  const t = await getTranslator("common");
  return (
    <main id="main-content" className="flex min-h-svh flex-col items-center justify-center gap-5 p-6 text-center">
      <title>{t("notFoundMetadata")} · GeoPro</title>
      <LanguageSwitcher />
      <h1 className="text-2xl font-semibold">{t("notFoundTitle")}</h1>
      <p className="max-w-lg text-muted-foreground">{t("notFoundDescription")}</p>
      <Button asChild><Link href="/">{t("backHome")}</Link></Button>
    </main>
  );
}

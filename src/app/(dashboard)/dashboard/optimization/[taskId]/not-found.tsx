import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getTranslator } from "@/lib/i18n/server";

export default async function NotFound() {
  const t = await getTranslator("optimization");
  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">{t("detailTitle")}</h1>
      <p role="alert" className="text-sm text-muted-foreground">{t("NOT_FOUND")}</p>
      <Button asChild>
        <Link href="/dashboard/optimization" prefetch={false}>{t("backToList")}</Link>
      </Button>
    </section>
  );
}

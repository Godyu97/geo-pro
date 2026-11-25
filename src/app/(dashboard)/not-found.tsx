import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getTranslator } from "@/lib/i18n/server";

export default async function WorkspaceNotFound() {
  const t = await getTranslator("common");
  return (
    <section className="min-w-0 space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">{t("notFoundTitle")}</h1>
      <p role="alert" className="max-w-xl text-sm leading-6 text-muted-foreground">{t("workspaceNotFoundDescription")}</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild><Link href="/dashboard" prefetch={false}>{t("overview")}</Link></Button>
        <Button asChild variant="outline"><Link href="/">{t("backHome")}</Link></Button>
      </div>
    </section>
  );
}

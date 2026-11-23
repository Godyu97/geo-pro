import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { listDemoBrands, listDemoObservations } from "./demo-commands.ts";
import type { DemoObservationView } from "./demo-contracts.ts";
import { DemoObservationsPanel } from "./demo-panel";

export async function generateMetadata() {
  const t = await getTranslator("demoObservations");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function DemoObservationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireSession();
  const params = await searchParams;
  const locale = await getLocale();
  const t = await getTranslator("demoObservations");
  const messages = getMessages(locale).demoObservations;
  const requested = typeof params.brandId === "string" ? params.brandId : "";
  const parsedBrand = brandIdSchema.safeParse(requested);
  const invalidBrand = requested.length > 0 && !parsedBrand.success;
  let brands: { id: string }[] | null = null;
  let observations: DemoObservationView[] = [];
  let notice: "INVALID_INPUT" | "NOT_FOUND" | "SERVICE_UNAVAILABLE" | null = invalidBrand ? "INVALID_INPUT" : null;
  try {
    const connection = getConnection();
    brands = await listDemoBrands(connection, user.id);
    if (parsedBrand.success) {
      const listed = await listDemoObservations(connection, user.id, parsedBrand.data);
      if ("error" in listed) notice = listed.error === "NOT_FOUND" ? "NOT_FOUND" : "SERVICE_UNAVAILABLE";
      else observations = listed.observations;
    }
  } catch {
    console.error("demo-observations-page-unavailable");
    brands = null;
  }
  if (!brands) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <Badge variant="outline">{t("demoBadge")}</Badge>
        <p role="alert" className="text-sm leading-6 text-destructive">{t("SERVICE_UNAVAILABLE")}</p>
        <Link href="/dashboard/monitoring/overview" prefetch={false} className="inline-block text-sm underline underline-offset-4">{t("backMonitoring")}</Link>
      </div>
    );
  }
  const labels = await loadOwnedLabels(getConnection(), brands.map((brand) => brand.id)).catch(() => []);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <Badge variant="outline">{t("demoBadge")}</Badge>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("description")}</p>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("notVerified")}</p>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("fixtureNote")}</p>
      </div>
      {notice ? <p role="alert" className="text-sm leading-6 text-destructive">{t(notice)}</p> : null}
      <DemoObservationsPanel
        brands={brands}
        observations={observations}
        labels={labels}
        selectedBrandId={notice === null && parsedBrand.success ? parsedBrand.data : ""}
        idle={requested.length === 0}
        messages={messages}
      />
      <Link href="/dashboard/monitoring/overview" prefetch={false} className="inline-block text-sm underline underline-offset-4">{t("backMonitoring")}</Link>
    </div>
  );
}

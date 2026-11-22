import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { Button } from "@/components/ui/button";
import { brandIdSchema } from "../brands/contracts";
import { BrandDao } from "../brands/dao";
import { readContentCalendar } from "./maintenance";

export async function generateMetadata() {
  const t = await getTranslator("content");
  return { title: t("calendarTitle"), robots: { index: false, follow: false } };
}

export default async function ContentCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const t = await getTranslator("content");
  const connection = getConnection();
  const active = await new BrandDao(connection).active(session.user.id);
  const requested = typeof params.brandId === "string" ? params.brandId : active?.id;
  if (!requested || !brandIdSchema.safeParse(requested).success) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("calendarTitle")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>
        <Button asChild><Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link></Button>
      </div>
    );
  }

  const calendar = await readContentCalendar(connection, session.user.id, { brandId: requested });
  if ("error" in calendar) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("calendarTitle")}</h1>
        <p role="alert" className="text-sm">{t(calendar.error)}</p>
      </div>
    );
  }

  const statusLabel = {
    planned: t("maintenancePlanned"),
    verified: t("maintenanceVerified"),
    blocked: t("maintenanceBlocked"),
  } as const;
  const reasonLabel = {
    expired: t("calendarReasonExpired"),
    revoked: t("calendarReasonRevoked"),
  } as const;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href={`/dashboard/content?brandId=${requested}`} prefetch={false} className="underline-offset-4 hover:underline">
            {t("backToContent")}
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("calendarTitle")}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("calendarDescription")}</p>
      </div>
      {calendar.tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("calendarEmpty")}</p>
      ) : calendar.tasks.map((task) => (
        <section key={task.id} className="space-y-4">
          <h2 className="text-lg font-semibold">{reasonLabel[task.reason]}</h2>
          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-secondary/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium" scope="col">{t("calendarPage")}</th>
                  <th className="px-4 py-3 font-medium" scope="col">{t("calendarChannel")}</th>
                  <th className="px-4 py-3 font-medium" scope="col">{t("plannedOn")}</th>
                  <th className="px-4 py-3 font-medium" scope="col">{t("verifiedOn")}</th>
                  <th className="px-4 py-3 font-medium" scope="col">{t("maintenanceStatus")}</th>
                  <th className="px-4 py-3 font-medium" scope="col">{t("publishState")}</th>
                </tr>
              </thead>
              <tbody>
                {task.pages.map((page) => (
                  <tr key={page.id} className="border-t">
                    <td className="max-w-xs break-all px-4 py-3">{page.pageUrl}</td>
                    <td className="px-4 py-3">{page.channel}</td>
                    <td className="px-4 py-3">{page.plannedOn ?? t("calendarNoDate")}</td>
                    <td className="px-4 py-3">{page.verifiedOn ?? t("notVerifiedYet")}</td>
                    <td className="px-4 py-3">{statusLabel[page.status]}</td>
                    <td className="px-4 py-3">{page.published ? t("liveAfterVerification") : t("notLive")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

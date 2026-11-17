import { Skeleton } from "@/components/ui/skeleton";
import { getTranslator } from "@/lib/i18n/server";

export default async function DashboardLoading() {
  const t = await getTranslator("common");
  return (
    <div role="status" aria-label={t("loading")} className="space-y-6">
      <Skeleton className="h-52 w-full rounded-2xl" />
      <Skeleton className="h-44 w-full rounded-2xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-48 rounded-2xl" />)}
      </div>
      <span className="sr-only">{t("loading")}</span>
    </div>
  );
}

import { Skeleton } from "@/components/ui/skeleton";
import { getTranslator } from "@/lib/i18n/server";

export default async function LocalObservationsLoading() {
  const t = await getTranslator("localObservations");
  return (
    <div role="status" aria-label={t("loading")} className="min-w-0 space-y-5">
      <p className="text-sm text-muted-foreground">{t("loading")}</p>
      <Skeleton aria-hidden="true" className="h-28 w-full rounded-2xl" />
      <Skeleton aria-hidden="true" className="h-40 w-full rounded-2xl" />
    </div>
  );
}

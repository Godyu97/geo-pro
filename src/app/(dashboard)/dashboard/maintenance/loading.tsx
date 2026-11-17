import { getTranslator } from "@/lib/i18n/server";
import { Skeleton } from "@/components/ui/skeleton";

export default async function MaintenanceLoading() {
  const t = await getTranslator("maintenance");
  return <div role="status" aria-label={t("loading")} className="space-y-5"><p>{t("loading")}</p><Skeleton className="h-32 w-full" /><Skeleton className="h-40 w-full" /></div>;
}

import { Skeleton } from "@/components/ui/skeleton";
import { getTranslator } from "@/lib/i18n/server";

export default async function SupportLoading() {
  const t = await getTranslator("support");
  return <div role="status" aria-label={t("loading")} className="space-y-5"><p>{t("loading")}</p><Skeleton className="h-28 w-full" /><Skeleton className="h-40 w-full" /></div>;
}

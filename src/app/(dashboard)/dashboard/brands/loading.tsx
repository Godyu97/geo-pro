import { Skeleton } from "@/components/ui/skeleton";
import { getTranslator } from "@/lib/i18n/server";

export default async function BrandsLoading() {
  const t = await getTranslator("brands");
  return (
    <div role="status" className="min-w-0 space-y-4">
      <p className="break-words">{t("loading")}</p>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

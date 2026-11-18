import { Skeleton } from "@/components/ui/skeleton";
import { getTranslator } from "@/lib/i18n/server";

export default async function BrandsLoading() {
  const t = await getTranslator("brands");
  return (
    <div role="status" className="max-w-3xl space-y-4">
      <p>{t("loading")}</p>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

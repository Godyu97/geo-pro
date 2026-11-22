import { Skeleton } from "@/components/ui/skeleton";
import { getTranslator } from "@/lib/i18n/server";

export default async function ImageAssetsLoading() {
  const t = await getTranslator("imageAssets");
  return (
    <div role="status" className="space-y-5">
      <p>{t("loading")}</p>
      <Skeleton className="h-56 w-full" />
    </div>
  );
}

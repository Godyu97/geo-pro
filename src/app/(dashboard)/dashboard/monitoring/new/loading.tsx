import { Skeleton } from "@/components/ui/skeleton";
import { getTranslator } from "@/lib/i18n/server";

export default async function RunConfirmLoading() {
  const t = await getTranslator("capabilities");
  return (
    <div role="status" className="space-y-5">
      <p>{t("loading")}</p>
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
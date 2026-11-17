import { Skeleton } from "@/components/ui/skeleton";
import { getTranslator } from "@/lib/i18n/server";

export default async function SettingsLoading() {
  const t = await getTranslator("settings");

  return (
    <div role="status" className="space-y-5">
      <p>{t("loading")}</p>
      <Skeleton className="h-56 w-full" />
    </div>
  );
}

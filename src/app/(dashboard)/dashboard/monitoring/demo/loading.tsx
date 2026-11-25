import { Skeleton } from "@/components/ui/skeleton";
import { getTranslator } from "@/lib/i18n/server";

export default async function DemoObservationsLoading() {
  const t = await getTranslator("demoObservations");
  return (
    <div role="status" className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("loading")}</p>
      <Skeleton aria-hidden="true" className="h-56 w-full" />
    </div>
  );
}

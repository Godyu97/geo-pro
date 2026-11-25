import { Skeleton } from "@/components/ui/skeleton";
import { getTranslator } from "@/lib/i18n/server";

export default async function CaptureLoading() {
  const t = await getTranslator("assistedCapture");
  return (
    <div role="status" aria-label={t("loading")} className="space-y-5">
      <p className="text-sm text-muted-foreground">{t("loading")}</p>
      <Skeleton aria-hidden="true" className="h-28 w-full rounded-2xl" />
      <Skeleton aria-hidden="true" className="h-56 w-full rounded-2xl" />
    </div>
  );
}

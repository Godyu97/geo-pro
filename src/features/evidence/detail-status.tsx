import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getTranslator } from "@/lib/i18n/server";
import { RetryEvidenceRead } from "./retry-evidence-read";

export async function EvidenceDetailStatus({ state }: { state: "loading" | "failed" | "not-found" }) {
  const t = await getTranslator("evidence");
  const common = await getTranslator("common");
  const overview = await getTranslator("evidenceOverview");

  return (
    <section className="min-w-0 space-y-4">
      <h1 className="wrap-anywhere text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <div className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
        {state === "loading" ? (
          <div role="status" className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("detailLoading")}</p>
            <Skeleton aria-hidden="true" className="h-24 w-full" />
          </div>
        ) : (
          <>
            <p role={state === "failed" ? "alert" : undefined} className="text-sm text-muted-foreground">
              {state === "failed" ? t("SERVICE_UNAVAILABLE") : t("NOT_FOUND")}
            </p>
            <div className="flex flex-wrap gap-2">
              {state === "failed" && <RetryEvidenceRead label={common("retry")} />}
              <Button asChild variant={state === "failed" ? "outline" : "default"}>
                <Link href="/dashboard/monitoring/answers" prefetch={false}>{overview("backAnswers")}</Link>
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

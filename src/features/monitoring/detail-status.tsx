import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getTranslator } from "@/lib/i18n/server";
import { CapabilityRetryButton } from "../capabilities/retry-button";

type RunDetailState = { state: "loading" | "not-found" } | { state: "failed"; traceId: string };

export async function RunDetailStatus(props: RunDetailState) {
  const t = await getTranslator("monitoring");
  return (
    <section className="min-w-0 space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("detailTitle")}</h1>
      <div className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
        {props.state === "loading" ? (
          <div role="status" className="space-y-4 text-sm text-muted-foreground">
            <p>{t("loading")}</p>
            <Skeleton aria-hidden="true" className="h-32 w-full" />
          </div>
        ) : (
          <>
            <p role={props.state === "failed" ? "alert" : undefined} className="text-sm text-muted-foreground">
              {t(props.state === "failed" ? "detailUnavailable" : "detailNotFound")}
            </p>
            <div className="flex flex-wrap gap-2">
              {props.state === "failed" && <CapabilityRetryButton label={t("retry")} />}
              <Button asChild variant={props.state === "failed" ? "outline" : "default"}>
                <Link href="/dashboard/monitoring/new" prefetch={false}>{t("back")}</Link>
              </Button>
            </div>
            {props.state === "failed" && <p className="wrap-anywhere text-xs text-muted-foreground">{t("trace", { id: props.traceId })}</p>}
          </>
        )}
      </div>
    </section>
  );
}

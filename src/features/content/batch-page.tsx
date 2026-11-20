import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { batchControlAction } from "./actions";
import { readBatch } from "./commands";

export async function generateMetadata() {
  const t = await getTranslator("content");
  return { title: t("batchDetail"), robots: { index: false, follow: false } };
}

export default async function ContentBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const session = await requireSession();
  const { batchId } = await params;
  const t = await getTranslator("content");
  const detail = await readBatch(getConnection(), session.user.id, batchId);
  if ("error" in detail) notFound();

  const { batch, units } = detail;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/dashboard/content" prefetch={false} className="underline-offset-4 hover:underline">
              {t("backToList")}
            </Link>
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("batchDetail")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{batch.id}</p>
        </div>
        <Badge variant="secondary">{batch.status}</Badge>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("units")}</h2>
        <ul className="space-y-3">
          {units.map((unit) => (
            <li key={unit.id} className="rounded-2xl border px-4 py-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{unit.briefId}</p>
                <Badge variant="outline">{unit.status}</Badge>
              </div>
              <p className="mt-2 text-muted-foreground">
                attempts={unit.attemptCount}
                {unit.contentVersionId ? ` · version=${unit.contentVersionId}` : ""}
                {unit.lastError ? ` · error=${unit.lastError}` : ""}
                {unit.blockedReason ? ` · blocked=${unit.blockedReason}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-wrap gap-2">
        {(["pause-batch", "resume-batch", "cancel-batch", "retry-failed"] as const).map((action) => (
          <form key={action} action={batchControlAction}>
            <input type="hidden" name="brandId" value={batch.brandId} />
            <input type="hidden" name="batchId" value={batch.id} />
            <input type="hidden" name="action" value={action} />
            <Button type="submit" variant="outline">{t(action)}</Button>
          </form>
        ))}
      </section>

      <p className="text-xs text-muted-foreground">{t("ledgerHint")}: {batch.costLedgerJson}</p>
    </div>
  );
}

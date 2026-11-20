import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateOptimizationAction } from "./actions";
import { readTaskDetail } from "./commands";

export async function generateMetadata() {
  const t = await getTranslator("optimization");
  return { title: t("detailTitle"), robots: { index: false, follow: false } };
}

export default async function OptimizationDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const session = await requireSession();
  const { taskId } = await params;
  const t = await getTranslator("optimization");
  const detail = await readTaskDetail(getConnection(), session.user.id, taskId);
  if ("error" in detail) notFound();

  const { task, findings, checks } = detail;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/dashboard/optimization" prefetch={false} className="underline-offset-4 hover:underline">
              {t("backToList")}
            </Link>
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{task.title}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{task.targetPage}</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline">{task.priorityBucket}</Badge>
          <Badge variant="secondary">{task.status}</Badge>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("findings")}</h2>
        <ul className="space-y-4">
          {findings.map((finding) => (
            <li key={finding.id} className="rounded-2xl border px-4 py-4 text-sm leading-7">
              <p className="font-medium">{finding.problemStatement}</p>
              <p className="mt-2 text-muted-foreground">{finding.hypothesis}</p>
              <p className="mt-2">{finding.evidenceSummary}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("assumption")}: {finding.assumptionLevel}
              </p>
              <ol className="mt-3 list-decimal space-y-1 pl-5">
                {(JSON.parse(finding.stepsJson) as string[]).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="mt-3"><span className="font-medium">{t("completion")}:</span> {finding.completionCriteria}</p>
              <p><span className="font-medium">{t("retest")}:</span> {finding.retestMethod}</p>
            </li>
          ))}
        </ul>
      </section>

      {checks.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t("pageChecks")}</h2>
          <ul className="space-y-3">
            {checks.map((check) => (
              <li key={check.id} className="rounded-xl border px-4 py-3 text-sm">
                <p className="font-medium">{check.normalizedUrl}</p>
                <p className="mt-1 text-muted-foreground">{check.publicStatus} · {check.accessCondition}</p>
                <p className="mt-2">{check.discoverabilityNotes}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3 rounded-2xl border p-5">
        <h2 className="text-lg font-semibold">{t("updateTitle")}</h2>
        <form action={updateOptimizationAction} className="space-y-3">
          <input type="hidden" name="brandId" value={task.brandId} />
          <input type="hidden" name="taskId" value={task.id} />
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("status")}</span>
            <select name="status" defaultValue={task.status} className="h-10 rounded-md border bg-background px-3">
              {["todo", "doing", "blocked", "implemented", "retest_pending", "closed", "dismissed"].map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("completionNote")}</span>
            <textarea name="completionNote" rows={3} className="w-full rounded-md border bg-background px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("dismissReason")}</span>
            <textarea name="dismissReason" rows={2} className="w-full rounded-md border bg-background px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("reorderReason")}</span>
            <div className="flex flex-wrap gap-2">
              <input
                name="manualRank"
                type="number"
                min={1}
                placeholder="1"
                className="h-10 w-24 rounded-md border bg-background px-3"
              />
              <input
                name="reorderReason"
                className="h-10 min-w-[16rem] flex-1 rounded-md border bg-background px-3"
              />
            </div>
          </label>
          <Button type="submit">{t("save")}</Button>
        </form>
      </section>
    </div>
  );
}

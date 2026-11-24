import type { ReactNode } from "react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts";
import { BrandDao } from "../brands/dao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listActionDrafts } from "./action-drafts";
import { checkPagesAction } from "./actions";
import { listPrioritizedTasks } from "./commands";
import { ActionDraftPanel } from "./draft-panel";
import { taskDisplayLabels } from "./task-labels.ts";

const actionClass = "h-auto min-h-9 max-w-full whitespace-normal text-left";
const fieldClass = "w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function OptimizationHeader({ title, children }: { title: string; children: ReactNode }) {
  return (
    <header className="min-w-0 space-y-3">
      <h1 className="wrap-anywhere text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
    </header>
  );
}

export async function generateMetadata() {
  const t = await getTranslator("optimization");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function OptimizationListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const locale = await getLocale();
  const messages = getMessages(locale);
  const t = await getTranslator("optimization");
  const connection = getConnection();
  const brands = new BrandDao(connection);
  const active = await brands.active(session.user.id);
  const brandId = typeof params.brandId === "string" ? params.brandId : active?.id;
  const brandsAction = (
    <Button asChild className={actionClass}>
      <Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link>
    </Button>
  );

  if (!brandId || !brandIdSchema.safeParse(brandId).success) {
    return (
      <OptimizationHeader title={t("title")}>
        {brandId ? (
          <p role="alert" className="max-w-2xl text-sm leading-7">{t("NOT_FOUND")}</p>
        ) : (
          <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>
        )}
        {brandsAction}
      </OptimizationHeader>
    );
  }

  const [listed, drafts] = await Promise.all([
    listPrioritizedTasks(connection, session.user.id, brandId, 50),
    listActionDrafts(connection, session.user.id, brandId),
  ]);
  if ("error" in listed) {
    return (
      <OptimizationHeader title={t("title")}>
        <p role="alert" className="max-w-2xl text-sm leading-7">{t(listed.error)}</p>
        {brandsAction}
      </OptimizationHeader>
    );
  }

  const hasTasks = listed.tasks.length > 0;
  const overviewHref = `/dashboard/monitoring/overview?brandId=${encodeURIComponent(brandId)}`;

  return (
    <div className="min-w-0 space-y-8">
      <OptimizationHeader title={t("title")}>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        <Button asChild variant={hasTasks ? "outline" : "default"} className={actionClass}>
          <Link href={overviewHref} prefetch={false}>{t("viewEvidenceOverview")}</Link>
        </Button>
      </OptimizationHeader>

      <section aria-labelledby="optimization-open-tasks" className="min-w-0 space-y-3">
        <h2 id="optimization-open-tasks" className="text-lg font-semibold">{t("openTasks")}</h2>
        {hasTasks ? (
          <ul className="space-y-3">
            {listed.tasks.map((task) => {
              const labels = taskDisplayLabels(messages.evidenceOverview, task);
              return (
                <li key={task.id} className="min-w-0 rounded-2xl border bg-card px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 max-w-full flex-1 basis-64 wrap-anywhere">
                      <Link
                        href={`/dashboard/optimization/${task.id}`}
                        prefetch={false}
                        className="inline-block max-w-full rounded-sm font-medium text-primary underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {task.title}
                      </Link>
                      <p className="mt-2 text-xs text-muted-foreground">{task.targetPage}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{t(task.gapType)}</p>
                    </div>
                    <div className="flex max-w-full flex-wrap gap-2">
                      <Badge variant="outline">{labels.priority}</Badge>
                      <Badge variant="secondary">{labels.status}</Badge>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground">
            {t("empty")}
          </p>
        )}
      </section>

      {"error" in drafts ? (
        <p role="alert" className="text-sm">{t(drafts.error)}</p>
      ) : (
        <ActionDraftPanel
          locale={locale}
          brandId={brandId}
          drafts={drafts.drafts}
          messages={messages.optimization}
        />
      )}

      <section className="min-w-0 space-y-3 rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-semibold">{t("checkPagesTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("checkPagesHint")}</p>
        <form action={checkPagesAction} className="space-y-3">
          <input type="hidden" name="brandId" value={brandId} />
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("urlsLabel")}</span>
            <textarea
              name="urls"
              rows={3}
              required
              className={fieldClass}
              placeholder="https://example.com/page"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("fixtureStatus")}</span>
            <select name="fixtureStatus" defaultValue="ok" className={fieldClass}>
              <option value="ok">{t("fixtureReachable")}</option>
              <option value="restricted">{t("fixtureRestricted")}</option>
              <option value="error">{t("fixtureReadError")}</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("fixtureBody")}</span>
            <textarea name="fixtureBody" rows={3} className={fieldClass} />
          </label>
          <Button type="submit" variant="outline" className={actionClass}>{t("runCheck")}</Button>
        </form>
      </section>
    </div>
  );
}

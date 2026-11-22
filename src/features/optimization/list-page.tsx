import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listActionDrafts } from "./action-drafts";
import { checkPagesAction } from "./actions";
import { listPrioritizedTasks } from "./commands";
import { ActionDraftPanel } from "./draft-panel";

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
  const t = await getTranslator("optimization");
  const connection = getConnection();
  const brands = new BrandDao(connection);
  const active = await brands.active(session.user.id);
  const brandId = typeof params.brandId === "string" ? params.brandId : active?.id;

  if (!brandId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>
        <Button asChild><Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link></Button>
      </div>
    );
  }

  const [listed, drafts] = await Promise.all([
    listPrioritizedTasks(connection, session.user.id, brandId, 50),
    listActionDrafts(connection, session.user.id, brandId),
  ]);
  if ("error" in listed) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{t(listed.error)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
      </div>

      {"error" in drafts ? (
        <p role="alert" className="text-sm">{t(drafts.error)}</p>
      ) : (
        <ActionDraftPanel
          locale={locale}
          brandId={brandId}
          drafts={drafts.drafts}
          messages={getMessages(locale).optimization}
        />
      )}

      <section className="space-y-3 rounded-2xl border p-5">
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
              className="w-full rounded-md border bg-background px-3 py-2"
              placeholder="https://example.com/page"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("fixtureStatus")}</span>
            <select name="fixtureStatus" defaultValue="ok" className="h-10 rounded-md border bg-background px-3">
              <option value="ok">ok</option>
              <option value="restricted">restricted</option>
              <option value="error">error</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("fixtureBody")}</span>
            <textarea name="fixtureBody" rows={3} className="w-full rounded-md border bg-background px-3 py-2" />
          </label>
          <Button type="submit">{t("runCheck")}</Button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("openTasks")}</h2>
        {listed.tasks.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <ul className="space-y-3">
            {listed.tasks.map((task) => (
              <li key={task.id} className="rounded-2xl border px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/dashboard/optimization/${task.id}`}
                      prefetch={false}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {task.title}
                    </Link>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {task.targetPage} · {task.gapType}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant="outline">{task.priorityBucket}</Badge>
                    <Badge variant="secondary">{task.status}</Badge>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

import Link from "next/link";
import { headers } from "next/headers";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { brandFixtureOrigin, brandIntakeOrigin } from "../brands/intake";
import { ApplyMockContentButton } from "@/features/functional-mock/run-buttons";
import { BrandDao } from "../brands/dao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { generateBatchAction, saveBriefAction } from "./actions";
import { listBriefs, listContentVersions, type ContentVersionFilter } from "./commands";

export async function generateMetadata() {
  const t = await getTranslator("content");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function ContentListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const t = await getTranslator("content");
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

  const listed = await listBriefs(connection, session.user.id, brandId, 50);
  if ("error" in listed) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{t(listed.error)}</p>
      </div>
    );
  }

  const filter: ContentVersionFilter | undefined = params.filter === "pending_review" || params.filter === "deliverable"
    ? params.filter
    : undefined;
  const versionList = await listContentVersions(connection, session.user.id, brandId, 50, filter);
  const versions = "versions" in versionList ? versionList.versions : [];
  const filters = [
    { key: undefined, label: t("filterAll") },
    { key: "pending_review", label: t("filterPending") },
    { key: "deliverable", label: t("filterDeliverable") },
  ] as const;

  const confirmedIds = listed.briefs
    .filter((item) => item.brief.status === "confirmed")
    .map((item) => item.brief.id);
  const fixtureSampling = Boolean(brandFixtureOrigin(await headers()));
  const mockLane = brandIntakeOrigin(await headers())?.mode === "mock";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        {mockLane && (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-muted-foreground">{t("mockContentNote")}</p>
            <ApplyMockContentButton
              brandId={brandId}
              label={t("applyMockContent")}
              pendingLabel={t("mockContentPending")}
              doneLabel={t("mockContentDone")}
              failedLabel={t("mockContentFailed")}
            />
          </div>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("plans")}</h2>
        {listed.plans.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("plansEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {listed.plans.map((plan) => (
              <li key={plan.id} className="rounded-2xl border px-4 py-4 text-sm">
                <p className="font-medium">{plan.questionCluster}</p>
                <p className="mt-2 text-muted-foreground">{plan.coverageJson}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border p-5">
        <h2 className="text-lg font-semibold">{t("newBrief")}</h2>
        <form action={saveBriefAction} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="brandId" value={brandId} />
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-muted-foreground">{t("questionCluster")}</span>
            <input name="questionCluster" required className="h-10 w-full rounded-md border bg-background px-3" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("audience")}</span>
            <input name="audience" className="h-10 w-full rounded-md border bg-background px-3" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("targetGap")}</span>
            <input name="targetGap" className="h-10 w-full rounded-md border bg-background px-3" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("boundary")}</span>
            <input name="applicableBoundary" className="h-10 w-full rounded-md border bg-background px-3" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("primaryPage")}</span>
            <input name="primaryPage" className="h-10 w-full rounded-md border bg-background px-3" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("conversionAction")}</span>
            <input name="conversionAction" className="h-10 w-full rounded-md border bg-background px-3" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("templateKind")}</span>
            <select name="templateKind" defaultValue="fact_faq" className="h-10 w-full rounded-md border bg-background px-3">
              <option value="fact_faq">fact_faq</option>
              <option value="scenario_solution">scenario_solution</option>
              <option value="verifiable_comparison">verifiable_comparison</option>
            </select>
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-muted-foreground">{t("titles")}</span>
            <textarea name="titleCandidates" rows={2} className="w-full rounded-md border bg-background px-3 py-2" />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-muted-foreground">{t("factIds")}</span>
            <textarea name="factVersionIds" rows={2} className="w-full rounded-md border bg-background px-3 py-2" />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-muted-foreground">{t("competitorSource")}</span>
            <input name="competitorSource" className="h-10 w-full rounded-md border bg-background px-3" />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit">{t("saveBrief")}</Button>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("briefs")}</h2>
        {listed.briefs.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="space-y-3">
            {listed.briefs.map(({ brief, version, gaps }) => (
              <li key={brief.id} className="rounded-2xl border px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/dashboard/content/briefs/${brief.id}`}
                      prefetch={false}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {version ? JSON.parse(version.titleCandidatesJson)[0] || brief.id : brief.id}
                    </Link>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {version?.primaryPage ?? "—"} · gaps={gaps.length}
                    </p>
                  </div>
                  <Badge variant="secondary">{brief.status}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("versions")}</h2>
        <nav className="flex flex-wrap gap-2 text-sm" aria-label={t("versions")}>
          {filters.map((item) => (
            <Link
              key={item.label}
              href={item.key ? `/dashboard/content?brandId=${brandId}&filter=${item.key}` : `/dashboard/content?brandId=${brandId}`}
              prefetch={false}
              aria-current={item.key === filter ? "page" : undefined}
              className={`rounded-full border px-3 py-1 ${item.key === filter ? "bg-muted font-medium" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {versions.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("versionsEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {versions.map((version) => (
              <li key={version.id} className="rounded-2xl border px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <Link
                    href={`/dashboard/content/versions/${version.id}`}
                    prefetch={false}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {version.title}
                  </Link>
                  <Badge variant="secondary">{version.status}</Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{version.targetChannel} · {version.updatedAt}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {confirmedIds.length > 0 ? (
        <section className="space-y-3 rounded-2xl border p-5">
          <h2 className="text-lg font-semibold">{t("generateBatch")}</h2>
          <form action={generateBatchAction} className="space-y-3">
            <input type="hidden" name="brandId" value={brandId} />
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">{t("briefIds")}</span>
              <textarea
                name="briefIds"
                rows={2}
                defaultValue={confirmedIds.slice(0, 5).join("\n")}
                className="w-full rounded-md border bg-background px-3 py-2"
              />
            </label>
            {fixtureSampling ? (
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">{t("fixtureFailBriefs")}</span>
                <textarea name="failBriefIds" rows={2} className="w-full rounded-md border bg-background px-3 py-2" />
              </label>
            ) : null}
            <Button type="submit">{t("runGenerate")}</Button>
          </form>
        </section>
      ) : null}
    </div>
  );
}

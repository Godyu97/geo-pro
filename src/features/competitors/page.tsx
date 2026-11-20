import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { Button } from "@/components/ui/button";
import { BrandDao } from "../brands/dao";
import {
  briefStatusAction,
  inspectCitationAction,
  proposeBriefAction,
  recordMentionsAction,
  saveCompetitorSetAction,
} from "./actions";
import { readCompetitorWorkspace } from "./commands";

export async function generateMetadata() {
  const t = await getTranslator("competitorAnalysis");
  return { title: t("title"), robots: { index: false, follow: false } };
}

function shareText(share: number | null, na: string) {
  return share === null ? na : String(share);
}

const sourceState = {
  observed: "state_observed",
  limited: "state_limited",
  resolved: "state_resolved",
  unknown: "state_unknown",
} as const;

export default async function CompetitorAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const t = await getTranslator("competitorAnalysis");
  const connection = getConnection();
  const brands = new BrandDao(connection);
  const active = await brands.active(session.user.id);
  const brandId = typeof params.brandId === "string" ? params.brandId : active?.id;
  const version = typeof params.version === "string" && /^[1-9]\d*$/.test(params.version)
    ? Number(params.version)
    : undefined;
  const error = typeof params.error === "string" ? params.error : "";
  const reason = typeof params.reason === "string" ? params.reason : "";

  if (!brandId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>
        <Button asChild><Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link></Button>
      </div>
    );
  }

  const workspace = await readCompetitorWorkspace(connection, session.user.id, brandId, version);
  if ("error" in workspace) {
    return <p role="alert" className="text-sm">{t(workspace.error === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_INPUT")}</p>;
  }

  const answersHref = `/dashboard/monitoring/answers?brandId=${brandId}`;
  const notice = reason === "copied_replacement"
    ? t("copied")
    : reason === "missing_evidence"
      ? t("missingEvidence")
      : error
        ? t(error === "OPERATION_CONFLICT" ? "OPERATION_CONFLICT" : error === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_INPUT")
        : "";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        </div>
        <Button asChild variant="outline">
          <Link href={answersHref} prefetch={false}>{t("backAnswers")}</Link>
        </Button>
      </div>
      {notice ? <p role="alert" className="text-sm">{notice}</p> : null}

      <section className="space-y-3 rounded-2xl border p-5">
        <h2 className="text-lg font-semibold">{t("sets")}</h2>
        {workspace.sets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("setsEmpty")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2 text-sm">
            {workspace.sets.map((set) => (
              <li key={set.id}>
                <Link
                  href={`/dashboard/monitoring/competitors?brandId=${brandId}&version=${set.version}`}
                  prefetch={false}
                  className="underline-offset-4 hover:underline"
                  aria-current={workspace.selected?.id === set.id ? "page" : undefined}
                >
                  {t("version", { version: set.version })}
                </Link>
                <span className="text-muted-foreground"> {set.labels.join(" · ") || t("shareNa")}</span>
              </li>
            ))}
          </ul>
        )}
        <form action={saveCompetitorSetAction} className="space-y-3">
          <input type="hidden" name="brandId" value={brandId} />
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("labels")}</span>
            <textarea name="labels" rows={4} className="w-full rounded-md border bg-background px-3 py-2" />
          </label>
          <Button type="submit">{t("saveSet")}</Button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("share")}</h2>
        {workspace.truncated ? <p className="text-sm text-muted-foreground">{t("truncated")}</p> : null}
        {workspace.rows.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("setsEmpty")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">{t("brand")}</th>
                <th className="py-2 pr-3 font-medium">{t("count")}</th>
                <th className="py-2 pr-3 font-medium">{t("denominator")}</th>
                <th className="py-2 font-medium">{t("shareValue")}</th>
              </tr>
            </thead>
            <tbody>
              {workspace.rows.map((row) => (
                <tr key={row.brandId} className="border-b">
                  <td className="py-2 pr-3">{row.brandId}</td>
                  <td className="py-2 pr-3">{row.count}</td>
                  <td className="py-2 pr-3">{row.denominator}</td>
                  <td className="py-2">{shareText(row.share, t("shareNa"))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-sm text-muted-foreground">
          {workspace.rank.ranked
            ? t("mean", { mean: workspace.rank.mean === null ? t("shareNa") : workspace.rank.mean })
            : t("unordered")}
        </p>
        {workspace.rank.ranked && workspace.rank.excludedAbsent.length > 0 ? (
          <p className="text-sm text-muted-foreground">{t("absent", { names: workspace.rank.excludedAbsent.join(" · ") })}</p>
        ) : null}
        {workspace.rank.unorderedCount > 0 && workspace.rank.ranked ? (
          <p className="text-sm text-muted-foreground">{t("unorderedExcluded", { count: workspace.rank.unorderedCount })}</p>
        ) : null}
      </section>

      <section className="space-y-3 rounded-2xl border p-5">
        <h2 className="text-lg font-semibold">{t("record")}</h2>
        {workspace.observations.length === 0 || !workspace.selected ? (
          <p className="text-sm text-muted-foreground">{t("noObservations")}</p>
        ) : (
          <form action={recordMentionsAction} className="space-y-3">
            <input type="hidden" name="brandId" value={brandId} />
            <input type="hidden" name="setId" value={workspace.selected.id} />
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">{t("observation")}</span>
              <select name="observationId" className="h-10 w-full rounded-md border bg-background px-3">
                {workspace.observations.map((item) => (
                  <option key={item.id} value={item.id}>{item.questionText}</option>
                ))}
              </select>
            </label>
            <fieldset className="space-y-2">
              <legend className="text-sm text-muted-foreground">{t("brand")}</legend>
              {workspace.selected.labels.map((label) => (
                <label key={label} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="label" value={label} />
                  <span>{label}</span>
                  <input
                    name={`position:${label}`}
                    inputMode="numeric"
                    aria-label={`${t("position")} ${label}`}
                    className="h-9 w-20 rounded-md border bg-background px-2"
                  />
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="ordered" />
              <span>{t("ordered")}</span>
            </label>
            <Button type="submit">{t("saveMentions")}</Button>
          </form>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("sources")}</h2>
        {workspace.hosts.length > 0 ? (
          <ul className="text-sm text-muted-foreground">
            {workspace.hosts.map((host) => (
              <li key={host.host}>{t("hosts")}: {host.host} · {host.pages}</li>
            ))}
          </ul>
        ) : null}
        {workspace.citations.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("sourcesEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {workspace.citations.map((citation) => (
              <li key={citation.citationId} className="rounded-2xl border px-4 py-3 text-sm">
                <p className="break-all">{citation.rawUrl}</p>
                <p className="mt-1 text-muted-foreground">
                  {t(sourceState[citation.state])} · {citation.support === "supports" ? t("supportSupports") : t("supportUnknown")}
                </p>
              </li>
            ))}
          </ul>
        )}
        {workspace.citations.length > 0 ? (
          <form action={inspectCitationAction} className="space-y-3 rounded-2xl border p-5">
            <h3 className="font-medium">{t("inspect")}</h3>
            <input type="hidden" name="brandId" value={brandId} />
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">{t("sources")}</span>
              <select name="citationId" className="h-10 w-full rounded-md border bg-background px-3">
                {workspace.citations.map((citation) => (
                  <option key={citation.citationId} value={citation.citationId}>{citation.rawUrl}</option>
                ))}
              </select>
            </label>
            {(["pageLive", "readable", "authorKnown", "supportsBrand"] as const).map((name) => (
              <label key={name} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={name} />
                <span>{t(name)}</span>
              </label>
            ))}
            <Button type="submit">{t("saveInspection")}</Button>
          </form>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("briefs")}</h2>
        {workspace.briefs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("briefsEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {workspace.briefs.map((brief) => (
              <li key={brief.id} className="rounded-2xl border px-4 py-3 text-sm">
                <p className="font-medium">{brief.questionCluster}</p>
                <p className="mt-1">{brief.gap}</p>
                <p className="mt-1 text-muted-foreground">{t(brief.status)} · {brief.sourceIds.length}</p>
                {brief.status === "proposed" ? (
                  <form action={briefStatusAction} className="mt-3 flex gap-2">
                    <input type="hidden" name="brandId" value={brandId} />
                    <input type="hidden" name="briefId" value={brief.id} />
                    <Button type="submit" name="status" value="accepted" size="sm">{t("accept")}</Button>
                    <Button type="submit" name="status" value="dismissed" size="sm" variant="outline">{t("dismiss")}</Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <form action={proposeBriefAction} className="space-y-3 rounded-2xl border p-5">
          <input type="hidden" name="brandId" value={brandId} />
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("questionCluster")}</span>
            <input name="questionCluster" required className="h-10 w-full rounded-md border bg-background px-3" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("gap")}</span>
            <textarea name="gap" required rows={3} className="w-full rounded-md border bg-background px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("facts")}</span>
            <textarea name="facts" rows={3} className="w-full rounded-md border bg-background px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("sources")}</span>
            <select name="sourceId" multiple className="min-h-24 w-full rounded-md border bg-background px-3 py-2">
              {workspace.citations.map((citation) => (
                <option key={citation.citationId} value={citation.citationId}>{citation.rawUrl}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("sourceText")}</span>
            <textarea name="sourceText" rows={3} className="w-full rounded-md border bg-background px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("briefText")}</span>
            <textarea name="briefText" rows={3} className="w-full rounded-md border bg-background px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("sourceBrand")}</span>
            <input name="sourceBrand" className="h-10 w-full rounded-md border bg-background px-3" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("ownBrand")}</span>
            <input name="ownBrand" className="h-10 w-full rounded-md border bg-background px-3" />
          </label>
          <Button type="submit">{t("saveBrief")}</Button>
        </form>
      </section>
    </div>
  );
}

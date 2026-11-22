import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { confirmBriefAction, saveBriefAction } from "./actions";
import { readBriefDetail } from "./commands";
import { FactDraftButton } from "./fact-draft-button";

export async function generateMetadata() {
  const t = await getTranslator("content");
  return { title: t("briefDetail"), robots: { index: false, follow: false } };
}

export default async function ContentBriefPage({
  params,
}: {
  params: Promise<{ briefId: string }>;
}) {
  const session = await requireSession();
  const { briefId } = await params;
  const t = await getTranslator("content");
  const detail = await readBriefDetail(getConnection(), session.user.id, briefId);
  if ("error" in detail) notFound();

  const { brief, version, gaps, fields } = detail;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/dashboard/content" prefetch={false} className="underline-offset-4 hover:underline">
              {t("backToList")}
            </Link>
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("briefDetail")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{brief.id}</p>
        </div>
        <Badge variant="secondary">{brief.status}</Badge>
      </div>

      {gaps.length > 0 ? (
        <section className="rounded-2xl border border-dashed px-4 py-4 text-sm">
          <p className="font-medium">{t("gapsTitle")}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            {gaps.map((gap) => <li key={gap.code}>{gap.code}</li>)}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3 rounded-2xl border p-5">
        <h2 className="text-lg font-semibold">{t("editBrief")}</h2>
        <form action={saveBriefAction} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="brandId" value={brief.brandId} />
          <input type="hidden" name="briefId" value={brief.id} />
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("audience")}</span>
            <input name="audience" defaultValue={fields?.audience ?? ""} className="h-10 w-full rounded-md border bg-background px-3" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("targetGap")}</span>
            <input name="targetGap" defaultValue={fields?.targetGap ?? ""} className="h-10 w-full rounded-md border bg-background px-3" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("boundary")}</span>
            <input name="applicableBoundary" defaultValue={fields?.applicableBoundary ?? ""} className="h-10 w-full rounded-md border bg-background px-3" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("primaryPage")}</span>
            <input name="primaryPage" defaultValue={fields?.primaryPage ?? ""} className="h-10 w-full rounded-md border bg-background px-3" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("conversionAction")}</span>
            <input name="conversionAction" defaultValue={fields?.conversionAction ?? ""} className="h-10 w-full rounded-md border bg-background px-3" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("templateKind")}</span>
            <select name="templateKind" defaultValue={fields?.templateKind ?? "fact_faq"} className="h-10 w-full rounded-md border bg-background px-3">
              <option value="fact_faq">fact_faq</option>
              <option value="scenario_solution">scenario_solution</option>
              <option value="verifiable_comparison">verifiable_comparison</option>
            </select>
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-muted-foreground">{t("titles")}</span>
            <textarea
              name="titleCandidates"
              rows={2}
              defaultValue={(fields?.titleCandidates ?? []).join("\n")}
              className="w-full rounded-md border bg-background px-3 py-2"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-muted-foreground">{t("factIds")}</span>
            <textarea
              name="factVersionIds"
              rows={2}
              defaultValue={(fields?.factVersionIds ?? []).join("\n")}
              className="w-full rounded-md border bg-background px-3 py-2"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-muted-foreground">{t("competitorSource")}</span>
            <input name="competitorSource" defaultValue={fields?.competitorSource ?? ""} className="h-10 w-full rounded-md border bg-background px-3" />
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit">{t("saveBrief")}</Button>
          </div>
        </form>
        {brief.status !== "confirmed" && gaps.length === 0 ? (
          <form action={confirmBriefAction} className="mt-3">
            <input type="hidden" name="brandId" value={brief.brandId} />
            <input type="hidden" name="briefId" value={brief.id} />
            <Button type="submit" variant="outline">{t("confirmBrief")}</Button>
          </form>
        ) : null}
        <div className="mt-4 space-y-2 border-t pt-4">
          <p className="text-sm text-muted-foreground">{t("factDraftHint")}</p>
          <FactDraftButton
            brandId={brief.brandId}
            briefId={brief.id}
            label={t("generateFactDraft")}
            pendingLabel={t("generatingFactDraft")}
            readyLabel={t("factDraftReady")}
            openLabel={t("openVersion")}
            fallbackError={t("AI_FAILED")}
          />
        </div>
        {version ? (
          <p className="mt-4 text-xs text-muted-foreground">
            rev {version.revision} · {version.templateKind}
          </p>
        ) : null}
      </section>
    </div>
  );
}

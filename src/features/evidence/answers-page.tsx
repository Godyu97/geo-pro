import Link from "next/link";
import { headers } from "next/headers";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { brandIntakeOrigin } from "@/features/brands/intake";
import { ApplyMockEvidenceButton } from "@/features/functional-mock/run-buttons";
import { BrandDao } from "../brands/dao";
import { Button } from "@/components/ui/button";
import { readEvidenceOverview } from "./overview-commands";
import { overviewScopeSchema } from "./overview-contracts";

export async function generateMetadata() {
  const t = await getTranslator("evidenceOverview");
  return { title: t("answersTitle"), robots: { index: false, follow: false } };
}

export default async function EvidenceAnswersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const t = await getTranslator("evidenceOverview");
  const te = await getTranslator("evidence");
  const connection = getConnection();
  const brands = new BrandDao(connection);
  const active = await brands.active(session.user.id);
  const mockLane = brandIntakeOrigin(await headers())?.mode === "mock";

  const brandId = typeof params.brandId === "string" ? params.brandId : active?.id;
  const sourceMode = typeof params.sourceMode === "string" ? params.sourceMode : "model_api";
  const region = typeof params.region === "string" ? params.region : undefined;

  if (!brandId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("answersTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("noBrand")}</p>
      </div>
    );
  }

  const parsed = overviewScopeSchema.safeParse({ brandId, sourceMode, region });
  if (!parsed.success) {
    return <p role="alert" className="text-sm">{t("invalidScope")}</p>;
  }

  const overview = await readEvidenceOverview(connection, session.user.id, parsed.data);
  if ("error" in overview) {
    return <p role="alert" className="text-sm">{te(overview.error)}</p>;
  }

  const overviewHref = `/dashboard/monitoring/overview?brandId=${overview.scope.brandId}&sourceMode=${overview.scope.sourceMode}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("answersTitle")}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">{t("answersDescription")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/dashboard/monitoring/competitors?brandId=${brandId}`} prefetch={false}>{t("competitors")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={overviewHref} prefetch={false}>{t("backOverview")}</Link>
          </Button>
        </div>
      </div>
      {mockLane && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{te("mockEvidenceNote")}</p>
          <ApplyMockEvidenceButton
            brandId={brandId}
            label={te("applyMockEvidence")}
            pendingLabel={te("mockEvidencePending")}
            doneLabel={te("mockEvidenceDone")}
            failedLabel={te("mockEvidenceFailed")}
          />
        </div>
      )}

      {overview.answers.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {t("emptyAnswers")}
        </p>
      ) : (
        <ul className="space-y-3">
          {overview.answers.map((answer) => (
            <li key={answer.observationId} className="rounded-2xl border p-4">
              <p className="text-sm font-medium wrap-anywhere">{answer.questionText}</p>
              <dl className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                <div>
                  <dt>{te("mentioned")}</dt>
                  <dd>{te(answer.mentioned)}</dd>
                </div>
                <div>
                  <dt>{te("recommended")}</dt>
                  <dd>{te(answer.recommended)}</dd>
                </div>
                <div>
                  <dt>{te("officialSiteCited")}</dt>
                  <dd>{te(answer.officialSiteCited)}</dd>
                </div>
              </dl>
              <div className="mt-4">
                <Button asChild size="sm" variant="outline">
                  <Link href={`/dashboard/monitoring/evidence/${answer.observationId}`} prefetch={false}>
                    {te("openEvidence")}
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

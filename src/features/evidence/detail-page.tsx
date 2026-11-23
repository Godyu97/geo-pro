import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { Button } from "@/components/ui/button";
import { listActionDrafts } from "../optimization/action-drafts";
import { generateOptimizationAction } from "../optimization/actions";
import { ActionDraftPanel } from "../optimization/draft-panel";
import { AnalysisDraftPanel } from "./analysis-draft-form";
import { readObservation } from "./commands";
import { ReviseAnalysisForm } from "./revise-form";

export async function generateMetadata() {
  const t = await getTranslator("evidence");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function EvidenceDetailPage({
  params,
}: {
  params: Promise<{ observationId: string }>;
}) {
  const session = await requireSession();
  const { observationId } = await params;
  const locale = await getLocale();
  const t = await getTranslator("evidence");
  const optimization = await getTranslator("optimization");
  const detail = await readObservation(getConnection(), session.user.id, observationId);
  if (!detail) notFound();

  const { observation, citations, analyses, latestAnalysis, citationPool, drafts } = detail;
  const actionDrafts = await listActionDrafts(getConnection(), session.user.id, observation.brandId, observation.id);
  const label = (value: "true" | "false" | "unknown") => t(value);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t("evidenceState")}</dt>
          <dd>{t(observation.evidenceState)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("fingerprint")}</dt>
          <dd className="break-all">{observation.fingerprint}</dd>
        </div>
      </dl>
      <section className="space-y-2">
        <h2 className="font-medium">{t("samplingConditions")}</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t("targetRegion")}</dt>
            <dd>{observation.targetRegion}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("observedRegion")}</dt>
            <dd>{observation.observedRegion === "unknown" ? t("observedRegionUnknown") : observation.observedRegion}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("newSession")}</dt>
            <dd>{label(observation.newSession)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("productMode")}</dt>
            <dd>{label(observation.productMode)}</dd>
          </div>
        </dl>
      </section>
      <section className="space-y-2">
        <h2 className="font-medium">{t("question")}</h2>
        <p className="wrap-anywhere text-sm">{observation.questionText}</p>
      </section>
      <section className="space-y-2">
        <h2 className="font-medium">{t("rawAnswer")}</h2>
        <p className="wrap-anywhere whitespace-pre-wrap rounded-lg border p-3 text-sm">{observation.answerText}</p>
      </section>
      <section className="space-y-2">
        <h2 className="font-medium">{t("citationPool")}</h2>
        <p className="text-sm">
          {citationPool.inC
            ? citationPool.cited
              ? t("cited")
              : t("notCited")
            : t("notInC", { reason: citationPool.reason ?? observation.citationSetState })}
        </p>
        <ul className="space-y-2 text-sm">
          {citations.map((item) => (
            <li key={item.id} className="rounded-lg border p-3 wrap-anywhere">
              <p>{item.citationOrigin}</p>
              <p>{item.normalizedUrl}</p>
              <p>{item.ownership} · {item.pageStatus}</p>
            </li>
          ))}
        </ul>
      </section>
      <AnalysisDraftPanel
        locale={locale}
        observationId={observation.id}
        expectedVersion={latestAnalysis?.version ?? null}
        drafts={drafts}
        messages={getMessages(locale).evidence}
      />
      {latestAnalysis && (
        <section className="space-y-2">
          <h2 className="font-medium">{t("analysisHistory")}</h2>
          <ul className="space-y-2 text-sm">
            {analyses.map((item) => (
              <li key={item.id} className="rounded-lg border p-3">
                <p>{t("version", { version: item.version })} · {item.status}</p>
                <p>{t("mentioned")}: {label(item.mentioned)}</p>
                <p>{t("recommended")}: {label(item.recommended)}</p>
                <p>{t("officialSiteCited")}: {label(item.officialSiteCited)}</p>
                {item.reason && <p className="text-muted-foreground">{item.reason}</p>}
              </li>
            ))}
          </ul>
          <ReviseAnalysisForm
            brandId={observation.brandId}
            observationId={observation.id}
            expectedVersion={latestAnalysis.version}
            initial={{
              mentioned: latestAnalysis.mentioned,
              recommended: latestAnalysis.recommended,
              officialSiteCited: latestAnalysis.officialSiteCited,
            }}
            messages={getMessages(locale).evidence}
          />
        </section>
      )}
      {"error" in actionDrafts ? (
        <p role="alert" className="text-sm">{optimization(actionDrafts.error)}</p>
      ) : (
        <ActionDraftPanel
          locale={locale}
          brandId={observation.brandId}
          evidenceIds={observation.evidenceState === "draft_evidence" ? undefined : [observation.id]}
          drafts={actionDrafts.drafts}
          messages={getMessages(locale).optimization}
        />
      )}
      {observation.evidenceState !== "draft_evidence" ? (
        <form action={generateOptimizationAction} className="rounded-2xl border px-4 py-4">
          <input type="hidden" name="brandId" value={observation.brandId} />
          <input type="hidden" name="observationId" value={observation.id} />
          <Button type="submit">{t("generateOptimization")}</Button>
        </form>
      ) : null}
      <Link className="inline-block text-sm underline underline-offset-4" href="/dashboard/monitoring" prefetch={false}>
        {t("backToRun")}
      </Link>
    </div>
  );
}

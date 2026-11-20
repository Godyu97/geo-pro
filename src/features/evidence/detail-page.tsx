import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { Button } from "@/components/ui/button";
import { generateOptimizationAction } from "../optimization/actions";
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
  const detail = await readObservation(getConnection(), session.user.id, observationId);
  if (!detail) notFound();

  const { observation, citations, analyses, latestAnalysis, citationPool } = detail;
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

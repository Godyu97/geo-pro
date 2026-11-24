import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { formatCount } from "@/lib/i18n/format";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { brandIntakeOrigin } from "@/features/brands/intake";
import { ApplyMockEvidenceButton } from "@/features/functional-mock/run-buttons";
import { BrandDao } from "../brands/dao";
import { Button } from "@/components/ui/button";
import { readEvidenceOverview } from "./overview-commands";
import { overviewScopeFromSearch, overviewScopePath } from "./overview-contracts";
import { OverviewScopeForm } from "./scope-form";

const actionClass = "h-auto max-w-full whitespace-normal text-left";
const relatedClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 break-words outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const itemClass = "min-w-0 rounded-2xl border bg-card p-4";
const emptyClass = "min-w-0 rounded-2xl border border-dashed bg-card px-4 py-8 text-center text-sm leading-7 break-words text-muted-foreground";

function relatedLinks(
  t: Awaited<ReturnType<typeof getTranslator<"evidenceOverview">>>,
  input: { overviewHref: string; competitorsHref: string },
) {
  return [
    { href: input.overviewHref, label: t("backOverview") },
    { href: input.competitorsHref, label: t("competitors") },
  ] as const;
}

function AnswerCanvas({
  title,
  summary,
  primary,
  relatedLabel,
  related,
  children,
}: {
  title: string;
  summary?: ReactNode;
  primary?: ReactNode;
  relatedLabel: string;
  related: ReadonlyArray<{ href: string; label: string }>;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-8">
      <header className="min-w-0 space-y-3">
        <h1 className="break-words text-2xl font-semibold tracking-tight">{title}</h1>
        {summary}
        {primary}
        <nav aria-label={relatedLabel} className="flex min-w-0 flex-wrap gap-2">
          {related.map((item) => (
            <Link key={item.href} href={item.href} prefetch={false} className={relatedClass}>
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
}

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
  const locale = await getLocale();
  const messages = getMessages(locale).evidenceOverview;
  const t = await getTranslator("evidenceOverview");
  const te = await getTranslator("evidence");
  const connection = getConnection();
  const brands = new BrandDao(connection);
  const active = await brands.active(session.user.id);
  const mockLane = brandIntakeOrigin(await headers())?.mode === "mock";
  const title = t("answersTitle");
  const brandsAction = (
    <Button asChild className={actionClass}>
      <Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link>
    </Button>
  );

  const brandId = (typeof params.brandId === "string" && params.brandId.trim())
    ? params.brandId.trim()
    : active?.id;

  if (!brandId) {
    return (
      <AnswerCanvas
        title={title}
        summary={<p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("answersNoBrand")}</p>}
        primary={brandsAction}
        relatedLabel={t("relatedEntries")}
        related={relatedLinks(t, {
          overviewHref: "/dashboard/monitoring/overview",
          competitorsHref: "/dashboard/monitoring/competitors",
        })}
      />
    );
  }

  const brandQuery = `?brandId=${encodeURIComponent(brandId)}`;
  const brandRelated = relatedLinks(t, {
    overviewHref: `/dashboard/monitoring/overview${brandQuery}`,
    competitorsHref: `/dashboard/monitoring/competitors${brandQuery}`,
  });
  const parsed = overviewScopeFromSearch(params, { brandId, sourceMode: "model_api" });
  if (!parsed.success) {
    return (
      <AnswerCanvas
        title={title}
        summary={<p role="alert" className="max-w-2xl break-words text-sm leading-7">{t("invalidScope")}</p>}
        primary={active?.id ? (
          <Button asChild variant="outline" className={actionClass}>
            <Link href={`/dashboard/monitoring/answers?brandId=${active.id}`} prefetch={false}>{t("clearFilters")}</Link>
          </Button>
        ) : undefined}
        relatedLabel={t("relatedEntries")}
        related={brandRelated}
      />
    );
  }

  const overview = await readEvidenceOverview(connection, session.user.id, parsed.data);
  if ("error" in overview) {
    return (
      <AnswerCanvas
        title={title}
        summary={<p role="alert" className="max-w-2xl break-words text-sm leading-7">{te(overview.error)}</p>}
        primary={overview.error === "NOT_FOUND" ? brandsAction : undefined}
        relatedLabel={t("relatedEntries")}
        related={brandRelated}
      />
    );
  }

  const overviewHref = overviewScopePath("/dashboard/monitoring/overview", parsed.data);
  const answerCount = formatCount(locale, overview.answers.length, {
    one: messages.answerCountOne,
    other: messages.answerCountOther,
  });

  return (
    <AnswerCanvas
      title={title}
      summary={(
        <>
          <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("answersDescription")}</p>
          <p className="max-w-full break-words text-sm font-medium">{overview.scope.brandName}</p>
        </>
      )}
      relatedLabel={t("relatedEntries")}
      related={relatedLinks(t, {
        overviewHref,
        competitorsHref: `/dashboard/monitoring/competitors${brandQuery}`,
      })}
    >
      <OverviewScopeForm scope={parsed.data} t={t} />
      <p className="break-words text-sm text-muted-foreground">{answerCount}</p>
      {mockLane && (
        <div className="min-w-0 space-y-2">
          <p className="max-w-2xl break-words text-sm leading-7 text-muted-foreground">{te("mockEvidenceNote")}</p>
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
        <p className={emptyClass}>{t("emptyAnswers")}</p>
      ) : (
        <ul className="min-w-0 space-y-3">
          {overview.answers.map((answer) => (
            <li key={answer.observationId} className={itemClass}>
              <p className="text-sm font-medium break-words wrap-anywhere">{answer.questionText}</p>
              <dl className="mt-3 grid min-w-0 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                <div className="min-w-0">
                  <dt className="break-words">{te("mentioned")}</dt>
                  <dd className="break-words">{te(answer.mentioned)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="break-words">{te("recommended")}</dt>
                  <dd className="break-words">{te(answer.recommended)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="break-words">{te("officialSiteCited")}</dt>
                  <dd className="break-words">{te(answer.officialSiteCited)}</dd>
                </div>
              </dl>
              <div className="mt-4">
                <Button asChild className={actionClass}>
                  <Link href={overviewScopePath(`/dashboard/monitoring/evidence/${answer.observationId}`, parsed.data)} prefetch={false}>
                    {te("openEvidence")}
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AnswerCanvas>
  );
}

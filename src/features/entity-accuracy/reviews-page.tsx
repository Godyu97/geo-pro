import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { entityReviewUnavailable, readEntityReviewWorkspace } from "./commands";
import { ReviewsWorkspace } from "./reviews-workspace";

const knownErrors = ["INVALID_INPUT", "NOT_FOUND", "SERVICE_UNAVAILABLE"] as const;
const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center";
const relatedLinkClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 whitespace-normal [overflow-wrap:anywhere] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function isKnownError(value: string | undefined): value is (typeof knownErrors)[number] {
  return knownErrors.some((code) => code === value);
}

export async function generateMetadata() {
  const t = await getTranslator("entityReviews");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function EntityReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const [locale, { id }, query] = await Promise.all([getLocale(), params, searchParams]);
  const brandId = brandIdSchema.safeParse(id);
  if (!brandId.success) notFound();

  const t = await getTranslator("entityReviews");
  const messages = getMessages(locale).entityReviews;
  const errorCode = typeof query.error === "string" ? query.error : undefined;
  const href = `/dashboard/brands/${brandId.data}`;
  const currentHref = `${href}/entity-reviews`;

  const result = await Promise.resolve()
    .then(() => readEntityReviewWorkspace(getConnection(), session.user.id, brandId.data))
    .catch(entityReviewUnavailable);

  if ("error" in result && result.error === "NOT_FOUND") notFound();

  if ("error" in result) {
    return (
      <div className="min-w-0 space-y-6">
        <header className="min-w-0 space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">{messages.title}</h1>
          <p role="alert" className="max-w-2xl text-sm leading-7 text-destructive">
            {messages.SERVICE_UNAVAILABLE}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild className={actionClass}>
              <a href={currentHref}>{messages.reload}</a>
            </Button>
            <Button asChild variant="outline" className={actionClass}>
              <Link href={href} prefetch={false}>{messages.back}</Link>
            </Button>
          </div>
          <p className="break-all text-xs text-muted-foreground">{t("trace", { id: result.traceId })}</p>
        </header>
      </div>
    );
  }

  const primaryActions = result.board.label === "sample" ? (
    <>
      <Button asChild className={actionClass}>
        <a href="#entity-review-summary">{messages.viewSampleSummary}</a>
      </Button>
      <Button asChild variant="outline" className={actionClass}>
        <a href="#entity-review-form">{messages.appendReviewAction}</a>
      </Button>
    </>
  ) : (
    <Button asChild className={actionClass}>
      <a href="#entity-review-form">{messages.appendReviewAction}</a>
    </Button>
  );

  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{messages.title}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{messages.description}</p>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{messages.activeBrandLabel}</span>
          <span className="[overflow-wrap:anywhere]">{result.brandName}</span>
          {result.brandStatus === "archived" ? (
            <Badge variant="secondary">{messages.archivedBadge}</Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {primaryActions}
          <Button asChild variant="outline" className={actionClass}>
            <Link href={href} prefetch={false}>{messages.back}</Link>
          </Button>
        </div>
        <nav aria-label={messages.relatedEntries} className="flex min-w-0 flex-wrap gap-2">
          <Link href={`${href}/entity-corrections`} prefetch={false} className={relatedLinkClass}>
            {messages.openCorrections}
          </Link>
          <Link href="/dashboard/monitoring/answers" prefetch={false} className={relatedLinkClass}>
            {messages.openAnswers}
          </Link>
          <Link href={`${href}/facts`} prefetch={false} className={relatedLinkClass}>
            {messages.openFacts}
          </Link>
          <Link href="/dashboard/brands" prefetch={false} className={relatedLinkClass}>
            {messages.allBrands}
          </Link>
        </nav>
      </header>

      <ReviewsWorkspace
        key={session.user.id + brandId.data}
        brandId={brandId.data}
        locale={locale}
        initialBoard={result.board}
        initialClaims={result.claims}
        messages={messages}
        initialError={isKnownError(errorCode) ? errorCode : null}
      />
    </div>
  );
}

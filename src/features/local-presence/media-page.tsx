import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { listMediaReviews } from "./media-commands.ts";
import { MediaReviewsPanel } from "./media-panel";

const entry = "/dashboard/content/media-reviews";
const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center";

export async function generateMetadata() {
  const t = await getTranslator("mediaReviews");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function MediaReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireSession();
  const params = await searchParams;
  const requested = brandIdSchema.safeParse(params.brandId);
  const locale = await getLocale();
  const t = await getTranslator("mediaReviews");
  const messages = getMessages(locale).mediaReviews;
  const requestedBrandId = requested.success ? requested.data : null;
  const retryHref = requestedBrandId ? `${entry}?brandId=${requestedBrandId}` : entry;
  const back = (
    <Button asChild variant="outline" className={actionClass}>
      <Link href="/dashboard/content" prefetch={false}>{messages.backContent}</Link>
    </Button>
  );

  let loaded;
  try {
    const db = getConnection();
    const workspace = await listMediaReviews(db, user.id);
    const labels = await loadOwnedLabels(db, workspace.brands.map((brand) => brand.id));
    loaded = { workspace, labels };
  } catch {
    const traceId = randomUUID();
    console.error("media-reviews-page-unavailable", { traceId });
    return (
      <header className="min-w-0 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p role="alert" className="text-sm leading-7 text-destructive">{t("SERVICE_UNAVAILABLE")}</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild className={actionClass}>
            <a href={retryHref}>{messages.reload}</a>
          </Button>
          {back}
        </div>
        <p className="text-xs break-all text-muted-foreground">{t("trace", { id: traceId })}</p>
      </header>
    );
  }

  const { workspace, labels } = loaded;
  const selected = workspace.brands.find((brand) => brand.id === requestedBrandId)
    ?? workspace.brands[0];
  const hasFacts = workspace.facts.length > 0;
  const hasReviews = workspace.reviews.length > 0;
  const fillCheck = <a href="#media-check-brand">{messages.fillCheck}</a>;
  const viewChecks = <a href="#media-check-history">{messages.viewChecks}</a>;

  let primary = hasReviews ? viewChecks : fillCheck;
  if (!selected) {
    primary = <Link href="/dashboard/brands" prefetch={false}>{messages.openBrands}</Link>;
  } else if (!hasFacts) {
    primary = <Link href={`/dashboard/brands/${selected.id}/facts`} prefetch={false}>{messages.openFacts}</Link>;
  }

  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("description")}</p>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("fixtureNote")}</p>
        {!selected && <p className="max-w-3xl rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground">{messages.noBrands}</p>}
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button asChild className={actionClass}>{primary}</Button>
          {hasReviews && (
            <Button asChild variant="outline" className={actionClass}>
              {selected && hasFacts ? fillCheck : viewChecks}
            </Button>
          )}
          {back}
        </div>
      </header>
      <MediaReviewsPanel
        key={selected?.id}
        brands={workspace.brands}
        facts={workspace.facts}
        reviews={workspace.reviews}
        labels={labels}
        messages={messages}
        initialBrandId={selected?.id ?? null}
      />
    </div>
  );
}

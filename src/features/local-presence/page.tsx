import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { listLocalObservations, localObservationsUnavailable } from "./commands.ts";
import { LocalObservationJump, LocalObservationsPanel } from "./panel";

const retryHref = "/dashboard/brands/local-observations";
const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center";
const relatedLinkClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 whitespace-normal [overflow-wrap:anywhere] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export async function generateMetadata() {
  const t = await getTranslator("localObservations");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function LocalObservationsPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("localObservations");
  const messages = getMessages(locale).localObservations;
  const listed = await listLocalObservations(getConnection(), user.id).catch(localObservationsUnavailable);
  if ("error" in listed) {
    return (
      <div className="min-w-0 space-y-6">
        <header className="min-w-0 space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">{messages.title}</h1>
          <p role="alert" className="max-w-2xl text-sm leading-7 text-destructive">{messages.SERVICE_UNAVAILABLE}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild className={actionClass}>
              <a href={retryHref}>{messages.reload}</a>
            </Button>
            <Button asChild variant="outline" className={actionClass}>
              <Link href="/dashboard/brands" prefetch={false}>{messages.backBrands}</Link>
            </Button>
          </div>
          <p className="text-xs break-all text-muted-foreground">{t("trace", { id: listed.traceId })}</p>
        </header>
      </div>
    );
  }

  let labels: { brandId: string; name: string }[] = [];
  try {
    labels = await loadOwnedLabels(getConnection(), listed.brands.map((brand) => brand.id));
  } catch (error) {
    const failed = localObservationsUnavailable(error);
    return (
      <div className="min-w-0 space-y-6">
        <header className="min-w-0 space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">{messages.title}</h1>
          <p role="alert" className="max-w-2xl text-sm leading-7 text-destructive">{messages.SERVICE_UNAVAILABLE}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild className={actionClass}>
              <a href={retryHref}>{messages.reload}</a>
            </Button>
            <Button asChild variant="outline" className={actionClass}>
              <Link href="/dashboard/brands" prefetch={false}>{messages.backBrands}</Link>
            </Button>
          </div>
          <p className="text-xs break-all text-muted-foreground">{t("trace", { id: failed.traceId })}</p>
        </header>
      </div>
    );
  }

  const nameFor = (brandId: string) => labels.find((label) => label.brandId === brandId)?.name ?? brandId;
  if (listed.brands.length === 0 && listed.observations.length === 0) {
    return (
      <div className="min-w-0 space-y-6">
        <header className="min-w-0 space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">{messages.title}</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{messages.description}</p>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{messages.fixtureNote}</p>
          <p className="max-w-3xl rounded-xl border border-dashed bg-card px-4 py-5 text-sm leading-6 break-words text-muted-foreground [overflow-wrap:anywhere]">{messages.noBrandTask}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild className={actionClass}>
              <Link href="/dashboard/brands" prefetch={false}>{messages.openBrand}</Link>
            </Button>
          </div>
          <nav aria-label={messages.relatedEntries} className="flex min-w-0 flex-wrap gap-2">
            <Link href="/dashboard/brands" prefetch={false} className={relatedLinkClass}>{messages.backBrands}</Link>
            <Link href="/dashboard/brands/stores" prefetch={false} className={relatedLinkClass}>{messages.openStores}</Link>
            <Link href="/dashboard" prefetch={false} className={relatedLinkClass}>{messages.backOverview}</Link>
          </nav>
        </header>
      </div>
    );
  }

  const hasObservations = listed.observations.length > 0;
  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{messages.title}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{messages.description}</p>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{messages.fixtureNote}</p>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{hasObservations ? messages.savedTask : messages.emptyTask}</p>
        {listed.brands.length > 0 ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{messages.activeBrand}</span>
            {listed.brands.map((brand) => (
              <span key={brand.id} className="min-w-0 [overflow-wrap:anywhere]">{nameFor(brand.id)}</span>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {hasObservations ? (
            <Button asChild className={actionClass}>
              <LocalObservationJump href="#local-observation-list">{messages.viewObservations}</LocalObservationJump>
            </Button>
          ) : (
            <Button asChild className={actionClass}>
              <LocalObservationJump href="#local-observation-target">{messages.fillObservation}</LocalObservationJump>
            </Button>
          )}
          <Button asChild variant="outline" className={actionClass}>
            <Link href="/dashboard/brands" prefetch={false}>{messages.backBrands}</Link>
          </Button>
        </div>
        <nav aria-label={messages.relatedEntries} className="flex min-w-0 flex-wrap gap-2">
          <Link href="/dashboard/brands" prefetch={false} className={relatedLinkClass}>{messages.backBrands}</Link>
          <Link href="/dashboard/brands/stores" prefetch={false} className={relatedLinkClass}>{messages.openStores}</Link>
          <Link href="/dashboard" prefetch={false} className={relatedLinkClass}>{messages.backOverview}</Link>
        </nav>
      </header>
      <LocalObservationsPanel
        brands={listed.brands}
        observations={listed.observations}
        labels={labels}
        locale={locale}
        messages={messages}
      />
    </div>
  );
}

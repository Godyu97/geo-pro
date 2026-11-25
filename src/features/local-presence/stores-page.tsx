import Link from "next/link";
import { WorkspaceJump } from "@/components/layout/workspace-jump";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { brandStoresUnavailable, listBrandStores } from "./store-commands.ts";
import { BrandStoresPanel } from "./stores-panel";

const retryHref = "/dashboard/brands/stores";
const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center";
const relatedLinkClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 whitespace-normal [overflow-wrap:anywhere] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export async function generateMetadata() {
  const t = await getTranslator("brandStores");
  return { title: t("title"), robots: { index: false, follow: false } };
}

function Unavailable({ title, message, reload, back, trace }: {
  title: string;
  message: string;
  reload: string;
  back: string;
  trace: string;
}) {
  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p role="alert" className="max-w-2xl text-sm leading-7 text-destructive">{message}</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild className={actionClass}>
            <a href={retryHref}>{reload}</a>
          </Button>
          <Button asChild variant="outline" className={actionClass}>
            <Link href="/dashboard/brands" prefetch={false}>{back}</Link>
          </Button>
        </div>
        <p className="text-xs break-all text-muted-foreground">{trace}</p>
      </header>
    </div>
  );
}

export default async function BrandStoresPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("brandStores");
  const messages = getMessages(locale).brandStores;
  const listed = await listBrandStores(getConnection(), user.id).catch(brandStoresUnavailable);
  if ("error" in listed) {
    return (
      <Unavailable
        title={messages.title}
        message={messages.SERVICE_UNAVAILABLE}
        reload={messages.reload}
        back={messages.backBrands}
        trace={t("trace", { id: listed.traceId })}
      />
    );
  }

  let labels: { brandId: string; name: string }[] = [];
  try {
    labels = await loadOwnedLabels(getConnection(), listed.brands.map((brand) => brand.id));
  } catch (error) {
    const failed = brandStoresUnavailable(error);
    return (
      <Unavailable
        title={messages.title}
        message={messages.SERVICE_UNAVAILABLE}
        reload={messages.reload}
        back={messages.backBrands}
        trace={t("trace", { id: failed.traceId })}
      />
    );
  }

  const nameFor = (brandId: string) => labels.find((label) => label.brandId === brandId)?.name ?? brandId;
  const related = (
    <nav aria-label={messages.relatedEntries} className="flex min-w-0 flex-wrap gap-2">
      <Link href="/dashboard/brands" prefetch={false} className={relatedLinkClass}>{messages.backBrands}</Link>
      <Link href="/dashboard/brands/local-observations" prefetch={false} className={relatedLinkClass}>{messages.openObservations}</Link>
      <Link href="/dashboard" prefetch={false} className={relatedLinkClass}>{messages.backOverview}</Link>
    </nav>
  );
  if (listed.brands.length === 0 && listed.stores.length === 0) {
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
          {related}
        </header>
      </div>
    );
  }

  const hasStores = listed.stores.length > 0;
  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{messages.title}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{messages.description}</p>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{messages.fixtureNote}</p>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{hasStores ? messages.savedTask : messages.emptyTask}</p>
        {listed.brands.length > 0 ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{messages.activeBrand}</span>
            {listed.brands.map((brand) => (
              <span key={brand.id} className="min-w-0 [overflow-wrap:anywhere]">{nameFor(brand.id)}</span>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {hasStores ? (
            <Button asChild className={actionClass}>
              <WorkspaceJump href="#brand-store-list">{messages.viewStores}</WorkspaceJump>
            </Button>
          ) : (
            <Button asChild className={actionClass}>
              <WorkspaceJump href="#brand-store-name">{messages.fillStore}</WorkspaceJump>
            </Button>
          )}
          <Button asChild variant="outline" className={actionClass}>
            <Link href="/dashboard/brands" prefetch={false}>{messages.backBrands}</Link>
          </Button>
        </div>
        {related}
      </header>
      <BrandStoresPanel
        brands={listed.brands}
        stores={listed.stores}
        uses={listed.uses}
        labels={labels}
        locale={locale}
        messages={messages}
      />
    </div>
  );
}

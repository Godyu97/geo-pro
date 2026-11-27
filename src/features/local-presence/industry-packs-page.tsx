import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspaceJump } from "@/components/layout/workspace-jump";
import { WorkspaceReadError, workspaceActionClass } from "@/components/layout/workspace-read-error";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { listIndustryPacks, readIndustryPacksForBrand } from "./industry-pack-commands.ts";
import { IndustryPacksPanel } from "./industry-packs-panel";

const entry = "/dashboard/brands/industry-packs";
const brandsHref = "/dashboard/brands";

export async function generateMetadata() {
  const t = await getTranslator("industryPacks");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function IndustryPacksPage({ searchParams }: {
  searchParams: Promise<{ brandId?: string | string[] }>;
}) {
  const { user } = await requireSession();
  const { brandId } = await searchParams;
  const selected = brandId === undefined ? null : brandIdSchema.safeParse(brandId);
  if (selected && !selected.success) notFound();
  const locale = await getLocale();
  const messages = getMessages(locale).industryPacks;
  const returnPath = selected ? `${entry}?brandId=${selected.data}` : entry;
  let loaded;
  try {
    const db = getConnection();
    const workspace = selected
      ? await readIndustryPacksForBrand(db, user.id, selected.data)
      : await listIndustryPacks(db, user.id);
    if (!("error" in workspace)) {
      const labels = await loadOwnedLabels(db, workspace.brands.map(({ id }) => id));
      loaded = { workspace, labels };
    }
  } catch {
    return <WorkspaceReadError title={messages.title} message={messages.SERVICE_UNAVAILABLE} reloadHref={returnPath}
      backHref={brandsHref} backLabel={messages.backBrands} logEvent="industry-packs-page-unavailable" />;
  }
  if (!loaded) notFound();

  const { workspace, labels } = loaded;
  const hasBrands = workspace.brands.length > 0;
  const editableBrands = workspace.brands.filter(({ canWrite }) => canWrite);
  const canRegister = editableBrands.length > 0;
  const hasPacks = workspace.packs.length > 0;
  const enterScope = <WorkspaceJump href="#industry-pack-scope">{messages.enterScope}</WorkspaceJump>;
  const viewPacks = <WorkspaceJump href="#industry-pack-list">{messages.viewPacks}</WorkspaceJump>;
  const primary = hasPacks ? viewPacks : canRegister ? enterScope
    : <Link href={brandsHref} prefetch={false}>{messages.openBrands}</Link>;

  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{messages.title}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{messages.task}</p>
        {!hasBrands && <p className="max-w-3xl rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground">{messages.noBrands}</p>}
        <div className="flex flex-wrap gap-2">
          <Button asChild className={workspaceActionClass}>
            {primary}
          </Button>
          {hasPacks && canRegister && <Button asChild variant="outline" className={workspaceActionClass}>{enterScope}</Button>}
          {hasBrands && (
            <Button asChild variant="outline" className={workspaceActionClass}>
              <Link href={brandsHref} prefetch={false}>{messages.backBrands}</Link>
            </Button>
          )}
        </div>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{messages.description}</p>
      </header>
      <IndustryPacksPanel brands={editableBrands} packs={workspace.packs} labels={labels} messages={messages}
        hasBrands={hasBrands} returnPath={returnPath} />
    </div>
  );
}

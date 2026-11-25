import Link from "next/link";
import { WorkspaceJump } from "@/components/layout/workspace-jump";
import { WorkspaceReadError, workspaceActionClass } from "@/components/layout/workspace-read-error";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { listIndustryPacks } from "./industry-pack-commands.ts";
import { IndustryPacksPanel } from "./industry-packs-panel";

const entry = "/dashboard/brands/industry-packs";
const brandsHref = "/dashboard/brands";

export async function generateMetadata() {
  const t = await getTranslator("industryPacks");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function IndustryPacksPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const messages = getMessages(locale).industryPacks;
  let loaded;
  try {
    const db = getConnection();
    const workspace = await listIndustryPacks(db, user.id);
    const labels = await loadOwnedLabels(db, workspace.brands.map(({ id }) => id));
    loaded = { workspace, labels };
  } catch {
    return <WorkspaceReadError title={messages.title} message={messages.SERVICE_UNAVAILABLE} reloadHref={entry}
      backHref={brandsHref} backLabel={messages.backBrands} logEvent="industry-packs-page-unavailable" />;
  }

  const { workspace, labels } = loaded;
  const hasBrands = workspace.brands.length > 0;
  const hasPacks = workspace.packs.length > 0;
  const enterScope = <WorkspaceJump href="#industry-pack-scope">{messages.enterScope}</WorkspaceJump>;
  const viewPacks = <WorkspaceJump href="#industry-pack-list">{messages.viewPacks}</WorkspaceJump>;
  const primary = hasBrands ? (hasPacks ? viewPacks : enterScope)
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
          {hasPacks && <Button asChild variant="outline" className={workspaceActionClass}>{hasBrands ? enterScope : viewPacks}</Button>}
          {hasBrands && (
            <Button asChild variant="outline" className={workspaceActionClass}>
              <Link href={brandsHref} prefetch={false}>{messages.backBrands}</Link>
            </Button>
          )}
        </div>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{messages.description}</p>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{messages.fixtureNote}</p>
      </header>
      <IndustryPacksPanel brands={workspace.brands} packs={workspace.packs} labels={labels} messages={messages} />
    </div>
  );
}

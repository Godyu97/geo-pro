import Link from "next/link";
import { WorkspaceJump } from "@/components/layout/workspace-jump";
import { WorkspaceReadError, workspaceActionClass } from "@/components/layout/workspace-read-error";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { listExplorationBrands, listExplorationObservations } from "./exploration-commands.ts";
import type { ExplorationObservationView } from "./exploration-contracts.ts";
import { ExplorationsPanel } from "./explorations-panel";

const entry = "/dashboard/monitoring/explorations";
const backHref = "/dashboard/monitoring/overview";

export async function generateMetadata() {
  const t = await getTranslator("explorations");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function ExplorationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireSession();
  const [params, locale] = await Promise.all([searchParams, getLocale()]);
  const messages = getMessages(locale).explorations;
  const requested = typeof params.brandId === "string" ? params.brandId : "";
  const parsedBrand = brandIdSchema.safeParse(requested);
  let observations: ExplorationObservationView[] = [];
  let notice: "INVALID_INPUT" | "NOT_FOUND" | null = requested && !parsedBrand.success ? "INVALID_INPUT" : null;
  let loaded;
  const unavailable = () => <WorkspaceReadError title={messages.title} message={messages.SERVICE_UNAVAILABLE}
    reloadHref={parsedBrand.success ? `${entry}?brandId=${encodeURIComponent(parsedBrand.data)}` : entry}
    backHref={backHref} backLabel={messages.backMonitoring} logEvent="explorations-page-unavailable" />;

  try {
    const db = getConnection();
    const brands = await listExplorationBrands(db, user.id);
    if (parsedBrand.success) {
      const listed = await listExplorationObservations(db, user.id, parsedBrand.data);
      if ("error" in listed) {
        if (listed.error !== "NOT_FOUND") return unavailable();
        notice = "NOT_FOUND";
      } else {
        observations = listed.observations;
      }
    }
    const labels = await loadOwnedLabels(db, brands.map((brand) => brand.id));
    loaded = { brands, labels };
  } catch {
    return unavailable();
  }

  const { brands, labels } = loaded;
  const enterObservation = <WorkspaceJump href="#exploration-question">{messages.enterObservation}</WorkspaceJump>;
  let primary = observations.length > 0 ? <WorkspaceJump href="#exploration-observations">{messages.viewObservations}</WorkspaceJump> : enterObservation;
  if (notice) {
    primary = <Link href={entry} prefetch={false}>{messages.clearBrand}</Link>;
  } else if (brands.length === 0 && observations.length === 0) {
    primary = <Link href="/dashboard/brands" prefetch={false}>{messages.openBrands}</Link>;
  }

  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{messages.title}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{messages.description}</p>
        {notice ? <p role="alert" className="text-sm leading-6 text-destructive">{messages[notice]}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button asChild className={workspaceActionClass}>{primary}</Button>
          {observations.length > 0 && brands.length > 0 && (
            <Button asChild variant="outline" className={workspaceActionClass}>{enterObservation}</Button>
          )}
          <Button asChild variant="outline" className={workspaceActionClass}>
            <Link href={backHref} prefetch={false}>{messages.backMonitoring}</Link>
          </Button>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{messages.fixtureNote}</p>
      </header>
      <ExplorationsPanel
        brands={brands}
        observations={observations}
        labels={labels}
        selectedBrandId={notice === null && parsedBrand.success ? parsedBrand.data : ""}
        idle={requested.length === 0}
        messages={messages}
      />
    </div>
  );
}

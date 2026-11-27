import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { brandIdSchema } from "@/features/brands/contracts";
import { brandMaterialAccess } from "@/features/brands/intake";
import { ApplyMockMaterialsButton } from "@/features/functional-mock/material-button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { readContentCalendar } from "../content/maintenance";
import { cursorValue, workspaceParams } from "./params";
import { factUnavailable, readFactWorkspace } from "./service";
import { FactWorkspaceView } from "./workspace";

const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center";

const maintenanceReasons = {
  expired: "calendarReasonExpired",
  revoked: "calendarReasonRevoked",
  mismatch: "calendarReasonMismatch",
  removed: "calendarReasonRemoved",
} as const;

async function FactMaintenance({ actorId, brandId, factId }: { actorId: string; brandId: string; factId: string }) {
  const t = await getTranslator("content");
  const facts = await getTranslator("brandFacts");
  const tasks = await Promise.resolve()
    .then(() => readContentCalendar(getConnection(), actorId, { brandId, factVersionId: factId }))
    .catch(() => ({ error: "SERVICE_UNAVAILABLE" as const }));
  if ("error" in tasks && tasks.error === "NOT_FOUND") return null;
  const href = `/dashboard/content/calendar?brandId=${encodeURIComponent(brandId)}&factVersionId=${encodeURIComponent(factId)}`;
  const rows = "error" in tasks ? [] : tasks.tasks;
  return (
    <section className="min-w-0 space-y-3 rounded-xl border bg-card px-4 py-4">
      <h2 className="text-lg font-semibold">{facts("maintenanceChain")}</h2>
      {"error" in tasks ? <p role="alert" className="text-sm leading-6">{facts("maintenanceChainUnavailable")}</p> : rows.length === 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">{facts("maintenanceChainEmpty")}</p>
      ) : rows.map((task) => (
        <div key={task.id} className="min-w-0 space-y-2 text-sm leading-6">
          <p className="font-medium">{t(maintenanceReasons[task.reason])}</p>
          <ul className="space-y-2">
            {task.pages.map((page) => (
              <li key={page.id} className="[overflow-wrap:anywhere]">
                {t("chainFact")}: {task.factVersionId}
                {" · "}
                {t("chainDraft")}: {page.draftId}
                {" · "}
                {t("chainVariant")}: {page.variantId ?? t("noVariant")}
                {" · "}
                {page.channel}
                {" · "}
                {page.pageUrl}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <Link href={href} prefetch={false} className={relatedLinkClass}>{facts("openMaintenanceCalendar")}</Link>
    </section>
  );
}
const relatedLinkClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 whitespace-normal [overflow-wrap:anywhere] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function materialNotice(material: ReturnType<typeof brandMaterialAccess>, messages: {
  mock: string; dev: string; fixture: string; devActorDenied: string; closed: string;
}) {
  if (!material.ok) return material.error === "devActorDenied" ? messages.devActorDenied : messages.closed;
  if (material.mode === "mock") return messages.mock;
  if (material.mode === "dev") return messages.dev;
  return messages.fixture;
}

export async function factMetadata() {
  return { title: getMessages(await getLocale()).brandFacts.title, robots: { index: false, follow: false } };
}

export async function BrandFactsPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireSession();
  const [locale, requestHeaders, { id }, raw] = await Promise.all([getLocale(), headers(), params, searchParams]);
  const t = await getTranslator("brandFacts");
  const messages = getMessages(locale).brandFacts;
  const query = workspaceParams.safeParse(raw);
  if (!brandIdSchema.safeParse(id).success || !query.success) notFound();
  const material = brandMaterialAccess(requestHeaders, user.email);
  const enabled = material.ok;
  const href = `/dashboard/brands/${id}`;

  if (!enabled) {
    return (
      <div className="min-w-0 space-y-6">
        <header className="min-w-0 space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">{messages.title}</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{messages.description}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild className={actionClass}>
              <Link href="/dashboard/brands" prefetch={false}>{messages.allBrands}</Link>
            </Button>
            <Button asChild variant="outline" className={actionClass}>
              <Link href="/dashboard/brands" prefetch={false}>{messages.back}</Link>
            </Button>
          </div>
        </header>
        <p role="status" className="rounded-xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground">
          {materialNotice(material, messages)}
        </p>
      </div>
    );
  }

  const retryParams = new URLSearchParams();
  if (query.data.fact) retryParams.set("fact", query.data.fact);
  if (query.data.paste) retryParams.set("paste", query.data.paste);
  if (query.data.after) retryParams.set("after", cursorValue(query.data.after));
  if (query.data.pasteAfter) retryParams.set("pasteAfter", cursorValue(query.data.pasteAfter));
  if (query.data.impactAfter) retryParams.set("impactAfter", query.data.impactAfter);
  const currentHref = retryParams.size ? `${href}/facts?${retryParams.toString()}` : `${href}/facts`;

  const result = await Promise.resolve()
    .then(() => readFactWorkspace(getConnection(), { ownerId: user.id, brandId: id }, query.data))
    .catch(factUnavailable);
  if (result === null) notFound();

  if ("error" in result) {
    return (
      <div className="min-w-0 space-y-6">
        <header className="min-w-0 space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">{messages.title}</h1>
          <p role="alert" className="max-w-2xl text-sm leading-7 text-destructive">{messages.unavailable}</p>
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

  const primaryAction = result.readOnly ? (
    <Button asChild className={actionClass}>
      <Link href={href} prefetch={false}>{messages.back}</Link>
    </Button>
  ) : result.fact?.state === "pending_confirmation" ? (
    <>
      <Button asChild className={actionClass}>
        <a href="#fact-editor-heading">{messages.reviewCurrentFact}</a>
      </Button>
      <Button asChild variant="outline" className={actionClass}>
        <a href="#fact-list-heading">{messages.browseFacts}</a>
      </Button>
    </>
  ) : result.versions.items.length > 0 ? (
    <>
      <Button asChild className={actionClass}>
        <a href="#fact-list-heading">{messages.browseFacts}</a>
      </Button>
      <Button asChild variant="outline" className={actionClass}>
        <a href="#fact-editor-heading">{messages.newFactAction}</a>
      </Button>
    </>
  ) : (
    <>
      <Button asChild className={actionClass}>
        <a href="#fact-source-heading">{messages.startPaste}</a>
      </Button>
      <Button asChild variant="outline" className={actionClass}>
        <a href="#fact-editor-heading">{messages.newFactAction}</a>
      </Button>
    </>
  );

  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{messages.title}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{messages.description}</p>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{messages.activeBrandLabel}</span>
          <span className="[overflow-wrap:anywhere]">{result.brandName}</span>
          {result.readOnly ? <Badge variant="secondary">{messages.readOnlyBadge}</Badge> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {primaryAction}
          {!result.readOnly ? (
            <Button asChild variant="outline" className={actionClass}>
              <Link href={href} prefetch={false}>{messages.back}</Link>
            </Button>
          ) : null}
        </div>
        <nav aria-label={messages.relatedEntries} className="flex min-w-0 flex-wrap gap-2">
          <Link href={`${href}/questions`} prefetch={false} className={relatedLinkClass}>
            {messages.openQuestions}
          </Link>
          <Link href="/dashboard/brands" prefetch={false} className={relatedLinkClass}>
            {messages.allBrands}
          </Link>
          <Link href="/dashboard/content/sources" prefetch={false} className={relatedLinkClass}>
            {messages.openSources}
          </Link>
          <Link href={`/dashboard/monitoring/new?brandId=${encodeURIComponent(id)}`} prefetch={false} className={relatedLinkClass}>
            {messages.openRunConfirm}
          </Link>
        </nav>
      </header>
      <aside className="min-w-0 max-w-3xl space-y-2 rounded-xl border bg-muted/50 px-4 py-3 text-sm leading-6 text-muted-foreground">
        <p className="[overflow-wrap:anywhere]">{materialNotice(material, messages)}</p>
        {material.mode === "mock" ? (
          <ApplyMockMaterialsButton
            brandId={id}
            label={messages.applyMockMaterials}
            pendingLabel={messages.mockMaterialsPending}
            doneLabel={messages.mockMaterialsDone}
            failedLabel={messages.mockMaterialsFailed}
          />
        ) : null}
      </aside>
      {result.fact ? <FactMaintenance actorId={user.id} brandId={id} factId={result.fact.id} /> : null}
      <FactWorkspaceView key={user.id + id} brandId={id} locale={locale} data={result} messages={messages} />
    </div>
  );
}

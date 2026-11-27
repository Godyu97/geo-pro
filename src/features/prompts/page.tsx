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
import { cursorValue, workspaceParams } from "./params";
import { promptUnavailable, readPromptWorkspace } from "./service";
import { PromptWorkspaceView } from "./workspace";

const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center";
const relatedLinkClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 whitespace-normal [overflow-wrap:anywhere] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function materialNotice(material: ReturnType<typeof brandMaterialAccess>, messages: {
  mock: string; dev: string; fixture: string; devActorDenied: string; closed: string;
}) {
  if (!material.ok) return material.error === "devActorDenied" ? messages.devActorDenied : messages.closed;
  if (material.mode === "mock") return messages.mock;
  if (material.mode === "dev") return messages.dev;
  return messages.fixture;
}

export async function promptMetadata() {
  return { title: getMessages(await getLocale()).promptSets.title, robots: { index: false, follow: false } };
}

export async function PromptSetsPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireSession();
  const [locale, requestHeaders, { id }, raw] = await Promise.all([getLocale(), headers(), params, searchParams]);
  const t = await getTranslator("promptSets");
  const messages = getMessages(locale).promptSets;
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
  if (query.data.version) retryParams.set("version", query.data.version);
  if (query.data.after) retryParams.set("after", cursorValue(query.data.after));
  const currentHref = retryParams.size ? `${href}/questions?${retryParams.toString()}` : `${href}/questions`;

  const result = await Promise.resolve()
    .then(() => readPromptWorkspace(getConnection(), { ownerId: user.id, brandId: id }, query.data))
    .catch(promptUnavailable);
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
    <>
      <Button asChild className={actionClass}>
        <Link href={href} prefetch={false}>{messages.back}</Link>
      </Button>
      {result.versions.items.length > 0 ? (
        <Button asChild variant="outline" className={actionClass}>
          <a href="#prompt-versions">{messages.browseVersions}</a>
        </Button>
      ) : null}
    </>
  ) : result.versions.items.length > 0 ? (
    <>
      <Button asChild className={actionClass}>
        <a href="#prompt-versions">{messages.browseVersions}</a>
      </Button>
      <Button asChild variant="outline" className={actionClass}>
        <a href="#prompt-questions">{messages.editDraftAction}</a>
      </Button>
    </>
  ) : result.editor.questions.length > 0 ? (
    <>
      <Button asChild className={actionClass}>
        <a href="#prompt-questions">{messages.reviewDraftAction}</a>
      </Button>
      <Button asChild variant="outline" className={actionClass}>
        <a href="#prompt-candidates">{messages.browseCandidates}</a>
      </Button>
    </>
  ) : (
    <>
      <Button asChild className={actionClass}>
        <a href="#prompt-candidates">{messages.browseCandidates}</a>
      </Button>
      <Button asChild variant="outline" className={actionClass}>
        <a href="#prompt-questions">{messages.addQuestionAction}</a>
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
          <Link href={`/dashboard/brands/industry-packs?brandId=${id}`} prefetch={false} className={relatedLinkClass}>
            {messages.openIndustryPacks}
          </Link>
          <Link href={`${href}/facts`} prefetch={false} className={relatedLinkClass}>
            {messages.openFacts}
          </Link>
          <Link href="/dashboard/brands" prefetch={false} className={relatedLinkClass}>
            {messages.allBrands}
          </Link>
          <Link href={`/dashboard/monitoring/new?brandId=${encodeURIComponent(id)}`} prefetch={false} className={relatedLinkClass}>
            {messages.openRunConfirm}
          </Link>
          <Link href="/dashboard/monitoring/plans" prefetch={false} className={relatedLinkClass}>
            {messages.openPlans}
          </Link>
          {!result.readOnly ? (
            <a href="#prompt-professional" className={relatedLinkClass}>{messages.loadProfessional}</a>
          ) : null}
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
      <PromptWorkspaceView key={user.id + id + (query.data.version ?? "")} brandId={id} locale={locale} data={result} messages={messages} />
    </div>
  );
}

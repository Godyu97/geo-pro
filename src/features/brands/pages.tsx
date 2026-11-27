import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2 } from "lucide-react";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { accountAccessPath } from "@/features/account/email/contracts";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { authorizeBrandActor } from "@/features/team-access/brand-scope";
import { TeamAccessDao } from "@/features/team-access/dao";
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { BrandForm, BrandIntakeJump } from "./brand-form";
import { BrandStatusButton } from "./brand-status-button";
import { brandRecoveryError } from "./commands";
import { archiveCursorSchema, brandIdSchema, brandVersionParam } from "./contracts";
import { BrandDeletionButtons } from "./deletion-buttons";
import { brandErrorMessage } from "./error-messages";
import { mockBrandFields } from "@/features/functional-mock/brand-profile";
import { brandIntakeDecision, type BrandIntakeMode } from "./intake";
import { CapabilityRetryButton } from "@/features/capabilities/retry-button";
import {
  BrandMonitoringReadiness,
  canPreviewMonitoringScope,
  readinessAction,
  readinessStepHref,
  readinessStepLabel,
} from "@/features/monitoring/brand-readiness";
import { readBrandMonitoringReadiness } from "@/features/monitoring/service";
import { readPilotAdmission, type PilotAdmissionItem } from "./pilot-admission";
import { brandUnavailable, readBrandData, readDeletionPreview, readDeletionRecovery, readNewBrandWorkspace } from "./service";
import type { RetentionView } from "./dao";

type Query = Record<string, string | string[] | undefined>;
type Translate = Awaited<ReturnType<typeof getTranslator<"brands">>>;

function BrandFrame({ title, back, backLabel, children }: { title: string; back: string; backLabel: string; children: ReactNode }) {
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <Link href={back} prefetch={false} className="inline-flex items-center gap-2 rounded-sm text-sm text-muted-foreground underline-offset-4 hover:underline">
          <ArrowLeft aria-hidden="true" className="size-4" />
          {backLabel}
        </Link>
        <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      </header>
      {children}
    </div>
  );
}

const admissionLabel = {
  emailDelivery: "admissionEmailDelivery",
  accountRecovery: "admissionAccountRecovery",
  retentionDisclosure: "admissionRetentionDisclosure",
  backupDrill: "admissionBackupDrill",
  pilotAuthorization: "admissionPilotAuthorization",
} as const;

function intakeCopy(mode: BrandIntakeMode) {
  if (mode === "real") return { label: "realLabel", description: "realDescription" } as const;
  if (mode === "mock") return { label: "mockLabel", description: "mockDescription" } as const;
  if (mode === "dev") return { label: "devLabel", description: "devDescription" } as const;
  return { label: "fixtureLabel", description: "fixtureDescription" } as const;
}

function PolicyText({ t, summaryZh, summaryEn, days }: { t: Translate; summaryZh: string; summaryEn: string; days: string }) {
  return (
    <div className="space-y-3 text-sm leading-6">
      <p className="text-muted-foreground">{t("retentionRecoverableDays", { days })}</p>
      <div className="space-y-1">
        <p className="font-medium">{t("retentionSummaryZh")}</p>
        <p className="whitespace-pre-wrap text-muted-foreground">{summaryZh}</p>
      </div>
      <div className="space-y-1">
        <p className="font-medium">{t("retentionSummaryEn")}</p>
        <p className="whitespace-pre-wrap text-muted-foreground">{summaryEn}</p>
      </div>
    </div>
  );
}

function acceptedRetention(view: RetentionView) {
  if (view.acceptedVersion === null || view.acceptedAt === null || view.acceptedSummaryZh === null || view.acceptedSummaryEn === null || view.acceptedRecoverableDays === null) return null;
  return {
    version: view.acceptedVersion, acceptedAt: view.acceptedAt, summaryZh: view.acceptedSummaryZh,
    summaryEn: view.acceptedSummaryEn, recoverableDays: view.acceptedRecoverableDays,
  };
}

function currentRetention(view: RetentionView) {
  if (view.currentVersion === null || view.currentSummaryZh === null || view.currentSummaryEn === null || view.currentRecoverableDays === null) return null;
  return {
    version: view.currentVersion, summaryZh: view.currentSummaryZh, summaryEn: view.currentSummaryEn,
    recoverableDays: view.currentRecoverableDays,
  };
}

function RetentionRecord({ t, locale, view }: { t: Translate; locale: Awaited<ReturnType<typeof getLocale>>; view: RetentionView }) {
  const accepted = acceptedRetention(view);
  const current = currentRetention(view);
  const newer = current !== null && (accepted === null || current.version > accepted.version);
  return (
    <section aria-labelledby="brand-retention" className="max-w-3xl space-y-4 rounded-xl border bg-card p-5">
      <h2 id="brand-retention" className="font-semibold">{t("retentionAcceptedTitle")}</h2>
      {accepted ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">{t("retentionAcceptedVersion", { version: formatNumber(locale, accepted.version) })}</p>
          <p className="text-sm text-muted-foreground">{t("retentionAcceptedAt", { time: formatDateTime(locale, new Date(accepted.acceptedAt)) })}</p>
          <PolicyText t={t} summaryZh={accepted.summaryZh} summaryEn={accepted.summaryEn} days={formatNumber(locale, accepted.recoverableDays)} />
        </div>
      ) : <p className="text-sm leading-6">{t("retentionMissing")}</p>}
      {newer && current && (
        <aside aria-label={t("retentionPreviewTitle")} className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-semibold">{t("retentionPreviewTitle")}</h3>
          <p className="text-sm leading-6 text-muted-foreground">
            {accepted
              ? t("retentionPreviewNote", { version: formatNumber(locale, current.version), accepted: formatNumber(locale, accepted.version) })
              : t("retentionPreviewUnaccepted")}
          </p>
          <PolicyText t={t} summaryZh={current.summaryZh} summaryEn={current.summaryEn} days={formatNumber(locale, current.recoverableDays)} />
        </aside>
      )}
    </section>
  );
}

function IntakeNotice({ t, mode }: { t: Translate; mode: BrandIntakeMode }) {
  const copy = intakeCopy(mode);
  return (
    <aside className="min-w-0 max-w-3xl space-y-2 break-words rounded-xl border bg-muted/50 p-4">
      <p className="text-sm font-semibold">{t(copy.label)}</p>
      <p className="text-sm leading-6 text-muted-foreground">{t(copy.description)}</p>
    </aside>
  );
}

const brandActionClass = "h-auto max-w-full whitespace-normal text-left";
const brandRelatedClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 break-words outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const brandEmptyClass = "min-w-0 rounded-2xl border border-dashed bg-card px-4 py-8 text-center text-sm leading-7 break-words text-muted-foreground";

function brandResourceLinks(t: Translate) {
  return [
    { href: "/dashboard/brands/local-observations", label: t("openLocalObservations") },
    { href: "/dashboard/brands/stores", label: t("openBrandStores") },
    { href: "/dashboard/brands/industry-packs", label: t("openIndustryPacks") },
  ] as const;
}

function brandRelated(t: Translate) {
  return [{ href: "/dashboard", label: t("workspace") }, ...brandResourceLinks(t)];
}

function BrandCanvas({
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
            <Link key={item.href} href={item.href} prefetch={false} className={brandRelatedClass}>
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
}

function ClosedBrandIntake({ t, items }: { t: Translate; items: PilotAdmissionItem[] }) {
  return (
    <BrandCanvas
      title={t("title")}
      summary={(
        <div className="max-w-2xl space-y-2">
          <h2 className="break-words text-base font-semibold">{t("closedTitle")}</h2>
          <p className="break-words text-sm leading-7 text-muted-foreground">{t("closedDescription")}</p>
        </div>
      )}
      primary={(
        <Button asChild className={brandActionClass}>
          <Link href="/dashboard" prefetch={false}>{t("workspace")}</Link>
        </Button>
      )}
      relatedLabel={t("relatedEntries")}
      related={brandResourceLinks(t)}
    >
      <section aria-labelledby="pilot-admission" className="min-w-0 space-y-3 rounded-2xl border bg-card p-5">
        <h2 id="pilot-admission" className="break-words font-semibold">{t("admissionTitle")}</h2>
        <p className="break-words text-sm leading-6 text-muted-foreground">{t("admissionDescription")}</p>
        <ul className="divide-y rounded-lg border">
          {items.map((item) => (
            <li key={item.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <span className="min-w-0 break-words">{t(admissionLabel[item.id])}</span>
              <span className="text-muted-foreground">{item.met ? t("admissionMet") : t("admissionUnmet")}</span>
            </li>
          ))}
        </ul>
        <p className="break-words text-sm leading-6 text-muted-foreground">{t("admissionRealIntakeClosed")}</p>
      </section>
    </BrandCanvas>
  );
}

function closedBrandIntake(t: Translate) {
  return <ClosedBrandIntake t={t} items={readPilotAdmission(process.env).items} />;
}

function DevActorDenied({ t }: { t: Translate }) {
  return (
    <BrandCanvas
      title={t("title")}
      summary={(
        <div className="max-w-2xl space-y-2">
          <h2 className="break-words text-base font-semibold">{t("devActorDeniedTitle")}</h2>
          <p className="break-words text-sm leading-7 text-muted-foreground">{t("devActorDeniedDescription")}</p>
        </div>
      )}
      primary={(
        <Button asChild className={brandActionClass}>
          <Link href="/dashboard" prefetch={false}>{t("workspace")}</Link>
        </Button>
      )}
      relatedLabel={t("relatedEntries")}
      related={brandResourceLinks(t)}
    />
  );
}

async function requireOpenIntake(email: string) {
  return brandIntakeDecision(await headers(), email);
}

function BrandLoadFailure({ t, href }: { t: Translate; href: string }) {
  return (
    <div role="alert" className="min-w-0 max-w-3xl space-y-3 rounded-xl border bg-card p-5">
      <p className="break-words text-sm leading-6">{t("unavailable")}</p>
      <Button asChild variant="outline" className={brandActionClass}>
        <a href={href}>{t("reload")}</a>
      </Button>
    </div>
  );
}

export async function BrandIndexPage({ searchParams }: { searchParams: Promise<Query> }) {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("brands");
  const decision = await requireOpenIntake(user.email);
  if (decision.state === "closed") return closedBrandIntake(t);
  if (decision.state === "denied") return <DevActorDenied t={t} />;
  const intake = decision.intake;
  const query = await searchParams;
  const cursor = archiveCursorSchema.safeParse({ at: query.before, id: query.id });
  const frozenCursor = archiveCursorSchema.safeParse({ at: query.frozenBefore, id: query.frozenId });
  const result = await readBrandData(async (dao) => {
    const [active, archive, frozen, accessible] = await Promise.all([
      dao.active(user.id),
      dao.archived(user.id, cursor.data),
      dao.frozen(user.id, frozenCursor.data),
      new TeamAccessDao(getConnection()).accessibleBrands(user.id, new Date().toISOString()),
    ]);
    const extraIds = accessible.filter((row) => row.brandId !== active?.id).map((row) => row.brandId);
    const extraScopes = extraIds.length > 0 ? await new TeamAccessDao(getConnection()).brandScopes(extraIds) : [];
    const roleByBrand = new Map(accessible.map((row) => [row.brandId, row.role]));
    const teamBrands = extraScopes.map((scope) => ({
      id: scope.brandId,
      name: scope.name,
      role: roleByBrand.get(scope.brandId) ?? "read_only",
    }));
    return { active, archive, frozen, teamBrands };
  });
  const title = t("title");
  const relatedLabel = t("relatedEntries");
  const summary = <p className="max-w-2xl break-words text-sm leading-7 text-muted-foreground">{t("pageDescription")}</p>;
  if ("unavailable" in result) {
    return (
      <BrandCanvas
        title={title}
        summary={summary}
        relatedLabel={relatedLabel}
        related={brandRelated(t)}
      >
        <BrandLoadFailure t={t} href="/dashboard/brands" />
      </BrandCanvas>
    );
  }
  const active = result.data.active;
  const teamBrands = result.data.teamBrands;
  const teamT = await getTranslator("teamAccess");
  const roleLabel = (role: "owner" | "member" | "read_only") =>
    role === "owner" ? teamT("roleOwner") : role === "member" ? teamT("roleMember") : teamT("roleReadOnly");
  return (
    <BrandCanvas
      title={title}
      summary={(
        <>
          {summary}
          {active ? <p className="max-w-full break-words text-sm font-medium">{active.name}</p> : null}
        </>
      )}
      primary={active ? (
        <Button asChild className={brandActionClass}>
          <Link href={"/dashboard/brands/" + active.id} prefetch={false}>{t("viewBrand")}</Link>
        </Button>
      ) : (
        <Button asChild className={brandActionClass}>
          <Link href="/dashboard/brands/new" prefetch={false}>{t("newOrResume")}</Link>
        </Button>
      )}
      relatedLabel={relatedLabel}
      related={brandRelated(t)}
    >
      <IntakeNotice t={t} mode={intake.mode} />
      <section aria-labelledby="brand-current" className="min-w-0 space-y-3">
        <h2 id="brand-current" className="break-words font-semibold">{t("currentBrand")}</h2>
        {active ? (
          <p className="min-w-0 break-words text-lg">{active.name}</p>
        ) : <p className={brandEmptyClass}>{t("noActiveBrand")}</p>}
      </section>
      <section aria-labelledby="brand-team" className="min-w-0 space-y-3">
        <h2 id="brand-team" className="break-words font-semibold">{t("teamBrands")}</h2>
        {teamBrands.length === 0 ? <p className={brandEmptyClass}>{t("noTeamBrands")}</p> : (
          <ul className="min-w-0 space-y-3">
            {teamBrands.map((brand) => (
              <li key={brand.id}>
                <Link href={"/dashboard/brands/" + brand.id} prefetch={false} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-2xl border bg-card p-4 text-sm break-words wrap-anywhere underline-offset-4 outline-none hover:underline focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                  <span>{brand.name}</span>
                  <Badge variant="outline">{roleLabel(brand.role)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="brand-archived" className="min-w-0 space-y-3">
        <h2 id="brand-archived" className="break-words font-semibold">{t("archivedBrands")}</h2>
        {result.data.archive.items.length === 0 ? <p className={brandEmptyClass}>{t("noArchived")}</p> : (
          <ul className="min-w-0 space-y-3">
            {result.data.archive.items.map((brand) => (
              <li key={brand.id}>
                <Link href={"/dashboard/brands/" + brand.id} prefetch={false} className="block min-w-0 rounded-2xl border bg-card p-4 text-sm break-words wrap-anywhere underline-offset-4 outline-none hover:underline focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">{brand.name}</Link>
              </li>
            ))}
          </ul>
        )}
        {result.data.archive.next && (
          <Button asChild variant="outline" className={brandActionClass}>
            <Link href={{ pathname: "/dashboard/brands", query: { before: result.data.archive.next.at, id: result.data.archive.next.id,
              frozenBefore: frozenCursor.data?.at, frozenId: frozenCursor.data?.id } }} prefetch={false}>
              {t("olderBrands")}
            </Link>
          </Button>
        )}
      </section>
      <section aria-labelledby="brand-frozen" className="min-w-0 space-y-3">
        <h2 id="brand-frozen" className="break-words font-semibold">{t("frozenBrands")}</h2>
        {result.data.frozen.items.length === 0 ? <p className={brandEmptyClass}>{t("noFrozenBrands")}</p> : (
          <ul className="min-w-0 space-y-3">
            {result.data.frozen.items.map((brand) => (
              <li key={brand.id}>
                <Link href={"/dashboard/brands/" + brand.id + "/recovery"} prefetch={false} className="block min-w-0 space-y-1 rounded-2xl border bg-card p-4 text-sm break-words underline-offset-4 outline-none hover:underline focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                  <span className="block">{t("brandFrozenAt", { time: formatDateTime(locale, new Date(brand.frozenAt)) })}</span>
                  <span className="block break-all text-muted-foreground">{brand.id}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {result.data.frozen.next && (
          <Button asChild variant="outline" className={brandActionClass}>
            <Link href={{ pathname: "/dashboard/brands", query: { frozenBefore: result.data.frozen.next.at, frozenId: result.data.frozen.next.id,
              before: cursor.data?.at, id: cursor.data?.id } }} prefetch={false}>
              {t("olderFrozenBrands")}
            </Link>
          </Button>
        )}
      </section>
    </BrandCanvas>
  );
}

export async function NewBrandPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("brands");
  const decision = await requireOpenIntake(user.email);
  if (decision.state === "closed") return closedBrandIntake(t);
  if (decision.state === "denied") return <DevActorDenied t={t} />;
  const intake = decision.intake;
  const result = await readNewBrandWorkspace(user.id).catch(() => brandUnavailable());
  const related = [{ href: "/dashboard/brands", label: t("allBrands") }, ...brandResourceLinks(t)];
  if ("unavailable" in result) {
    return (
      <BrandScopeFailure
        title={t("createTitle")}
        message={t("unavailable")}
        trace={t("trace", { id: result.traceId })}
        reloadLabel={t("reload")}
        reloadHref="/dashboard/brands/new"
        backLabel={t("allBrands")}
        backHref="/dashboard/brands"
      />
    );
  }
  const { active, draft, policy } = result.data;
  if (active) {
    return (
      <BrandCanvas
        title={t("createTitle")}
        summary={<p className="max-w-3xl break-words text-sm leading-6 text-muted-foreground">{t("createTaskActive")}</p>}
        primary={(
          <Button asChild className={brandActionClass}>
            <Link href={"/dashboard/brands/" + active.id} prefetch={false}>{t("viewBrand")}</Link>
          </Button>
        )}
        relatedLabel={t("relatedEntries")}
        related={related}
      >
        <IntakeNotice t={t} mode={intake.mode} />
        <Card className="min-w-0 max-w-3xl py-0 shadow-none">
          <CardContent className="space-y-3 p-5 sm:p-6">
            <p role="status" className="break-words text-sm leading-6">{t("limitReached")}</p>
            <p className="text-sm font-medium [overflow-wrap:anywhere]">{active.name}</p>
            <p className="break-words text-sm leading-6 text-muted-foreground">{t("archiveFirst")}</p>
          </CardContent>
        </Card>
      </BrandCanvas>
    );
  }
  return (
    <BrandCanvas
      title={t("createTitle")}
      summary={(
        <div className="max-w-3xl space-y-2">
          <p className="break-words text-sm leading-6 text-muted-foreground">{draft ? t("createTaskDraft") : t("createTask")}</p>
          {draft?.fields.name ? <p className="text-sm font-medium [overflow-wrap:anywhere]">{draft.fields.name}</p> : null}
        </div>
      )}
      primary={(
        <Button asChild className={brandActionClass}>
          <BrandIntakeJump href={draft?.step === 1 ? "#brand-region" : draft?.step === 2 ? "#brand-questions" : "#brand-name"}>
            {draft ? t("resumeDraft") : t("startIntake")}
          </BrandIntakeJump>
        </Button>
      )}
      relatedLabel={t("relatedEntries")}
      related={related}
    >
      <IntakeNotice t={t} mode={intake.mode} />
      <BrandForm key={user.id} actorId={user.id} draft={draft} target={null} policy={policy} messages={getMessages(locale).brands} mockProfile={intake.mode === "mock" ? mockBrandFields : undefined} />
    </BrandCanvas>
  );
}

export async function BrandDetailsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("brands");
  const decision = await requireOpenIntake(user.email);
  if (decision.state === "closed") return closedBrandIntake(t);
  if (decision.state === "denied") return <DevActorDenied t={t} />;
  const intake = decision.intake;
  const { id } = await params;
  const query = await searchParams;
  const version = brandVersionParam.safeParse(query.version);
  if (!brandIdSchema.safeParse(id).success || (query.version !== undefined && !version.success)) notFound();
  const href = "/dashboard/brands/" + id;
  const scope = await authorizeBrandActor(getConnection(), user.id, id, "read");
  if (!scope) notFound();
  const canManage = scope.role === "owner";
  const canWrite = scope.role !== "read_only";
  const result = await readBrandData(async (dao) => {
    const brand = await dao.version(scope.ownerId, id, version.data);
    if (!brand) return null;
    const editing = canManage && query.edit === "1" && query.version === undefined && brand.status === "active";
    return {
      brand, editing, draft: editing ? await dao.draft(scope.ownerId, id) : null,
      retention: editing ? null : await dao.retentionView(scope.ownerId, id),
    };
  });

  if ("unavailable" in result) {
    const retry = version.data ? href + "?version=" + version.data : query.edit === "1" ? href + "?edit=1" : href;
    return (
      <BrandCanvas
        title={t("title")}
        summary={<p role="alert" className="max-w-2xl break-words text-sm leading-7">{t("unavailable")}</p>}
        primary={(
          <Button asChild className={brandActionClass}>
            <a href={retry}>{t("reload")}</a>
          </Button>
        )}
        relatedLabel={t("relatedEntries")}
        related={[{ href: "/dashboard/brands", label: t("allBrands") }, ...brandResourceLinks(t)]}
      />
    );
  }
  if (!result.data) notFound();
  const { brand, editing, draft, retention } = result.data;
  const messages = getMessages(locale).brands;
  if (editing) return (
    <BrandFrame title={t("editTitle")} back={href} backLabel={t("viewBrand")}>
      <IntakeNotice t={t} mode={intake.mode} />
      <BrandForm key={user.id + id} actorId={user.id} target={{ brandId: id, expectedBrandRevision: brand.revision }}
        current={brand.fields} draft={draft} messages={messages} mockProfile={intake.mode === "mock" ? mockBrandFields : undefined} />
    </BrandFrame>
  );
  const snapshot = query.version !== undefined;
  const { description, website, region, language, aliases, competitors, questions } = brand.fields;
  const regionName = region === "CN" ? t("mainlandChina") : new Intl.DisplayNames(locale, { type: "region" }).of(region);
  const languageName = new Intl.DisplayNames(locale, { type: "language" }).of(language);
  const rows = [
    { title: t("fieldDescription"), values: [description] },
    { title: t("fieldWebsite"), values: website ? [website] : [] },
    { title: t("fieldAliases"), values: aliases },
    { title: t("fieldRegion"), values: [regionName + " (" + region + ")"] },
    { title: t("fieldLanguage"), values: [languageName + " (" + language + ")"] },
    { title: t("fieldCompetitors"), values: competitors },
    { title: t("stepQuestions"), values: questions },
  ];
  const readiness = await readBrandMonitoringReadiness(scope.ownerId, {
    id, status: brand.status, website,
  }, snapshot);
  const action = readinessAction(snapshot, readiness);
  const canPreviewScope = canPreviewMonitoringScope(snapshot, readiness);
  const monitoring = await getTranslator("monitoring");
  const factsTitle = getMessages(locale).brandFacts.title;
  const questionsTitle = getMessages(locale).promptSets.title;
  const primary = action.kind === "current" ? (
    <Button asChild className={brandActionClass}>
      <Link href={href} prefetch={false}>{t("currentVersion")}</Link>
    </Button>
  ) : canWrite && action.kind === "confirm" ? (
    <Button asChild className={brandActionClass}>
      <Link href={"/dashboard/monitoring/new?brandId=" + id} prefetch={false}>{t("readinessConfirm")}</Link>
    </Button>
  ) : canWrite && action.kind === "next" && action.step === "request-quota" && canPreviewScope ? (
    <Button asChild className={brandActionClass}>
      <Link href={"/dashboard/monitoring/new?brandId=" + id} prefetch={false}>{t("readinessPreview")}</Link>
    </Button>
  ) : canWrite && action.kind === "next" ? (
    <Button asChild className={brandActionClass}>
      <Link href={readinessStepHref(id, action.step)} prefetch={false}>{t(readinessStepLabel(action.step))}</Link>
    </Button>
  ) : action.kind === "retry" ? (
    <CapabilityRetryButton label={monitoring("retry")} />
  ) : null;
  const related = [
    { href: "/dashboard/brands", label: t("allBrands") },
    ...(!snapshot ? [
      { href: href + "/facts", label: factsTitle },
      { href: href + "/questions", label: questionsTitle },
    ] : []),
    ...brandResourceLinks(t),
  ];
  return (
    <BrandCanvas
      title={brand.fields.name}
      summary={(
        <div className="max-w-2xl space-y-3">
          <p className="break-words text-sm leading-7 text-muted-foreground">{t("detailTask")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary"><Building2 aria-hidden="true" />{t("versionLabel", { version: formatNumber(locale, brand.version) })}</Badge>
            <Badge variant="outline">{t(brand.status)}</Badge>
          </div>
          {readiness.kind === "unavailable" ? <p role="alert" className="break-words text-sm leading-6">{t("readinessUnavailable")}</p> : null}
        </div>
      )}
      primary={primary}
      relatedLabel={t("relatedEntries")}
      related={related}
    >
      <IntakeNotice t={t} mode={intake.mode} />
      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <BrandMonitoringReadiness brand={{ id, version: brand.version }} historical={snapshot} result={readiness} promoted />
        <Card className="min-w-0 py-0 shadow-none">
          <CardContent className="space-y-5 p-5 sm:p-6">
            <p className="text-sm leading-6 break-words text-muted-foreground">{t("updated", { time: formatDateTime(locale, new Date(brand.versionCreatedAt)) })}</p>
            {snapshot && <p className="text-sm font-medium break-words">{t("historicalVersion")}</p>}
            <dl className="grid gap-4 sm:grid-cols-2">
              {rows.map(({ title, values }) => (
                <div className="min-w-0 space-y-1 border-t pt-3" key={title}>
                  <dt className="text-sm font-medium">{title}</dt>
                  {values.length > 1 ? (
                    <dd><ul className="list-inside list-disc space-y-1 text-sm leading-6 break-words text-muted-foreground [overflow-wrap:anywhere]">
                      {values.map((value, index) => <li key={index}>{value}</li>)}
                    </ul></dd>
                  ) : <dd className="text-sm leading-6 break-words whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{values[0] ?? t("emptyValue")}</dd>}
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <div className="min-w-0 space-y-4 rounded-xl border bg-card p-5 lg:col-start-2">
          <div className="flex min-w-0 flex-wrap gap-2">
            {canManage && !snapshot && brand.status === "active" && <Button asChild className={brandActionClass}><Link href={href + "?edit=1"} prefetch={false}>{t("edit")}</Link></Button>}
            {brand.version > 1 && <Button asChild variant="outline" className={brandActionClass}><Link href={href + "?version=" + (brand.version - 1)} prefetch={false}>{t("previousVersion")}</Link></Button>}
          </div>
          {canManage && !snapshot && <BrandStatusButton brand={{ id, status: brand.status, revision: brand.revision }} actorId={user.id} messages={messages} />}
          {!snapshot && <Button asChild variant="outline" className={brandActionClass}><Link href={href + "/entity-reviews"} prefetch={false}>{getMessages(locale).entityReviews.title}</Link></Button>}
          {!snapshot && <Button asChild variant="outline" className={brandActionClass}><Link href={href + "/entity-corrections"} prefetch={false}>{getMessages(locale).entityCorrections.title}</Link></Button>}
          {canManage && !snapshot && <Button asChild variant="outline" className={brandActionClass}><Link href={href + "/delete"} prefetch={false}>{t("reviewDeletion")}</Link></Button>}
        </div>
      </div>
      {retention && <RetentionRecord t={t} locale={locale} view={retention} />}
    </BrandCanvas>
  );
}

function BrandScopeFailure({ title, message, trace, reloadLabel, reloadHref, backLabel, backHref }: {
  title: string; message: string; trace: string; reloadLabel: string; reloadHref: string; backLabel: string; backHref: string;
}) {
  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0 space-y-3">
        <h1 className="break-words text-2xl font-semibold tracking-tight">{title}</h1>
        <p role="alert" className="max-w-2xl break-words text-sm leading-7 text-destructive">{message}</p>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button asChild className={brandActionClass}>
            <a href={reloadHref}>{reloadLabel}</a>
          </Button>
          <Button asChild variant="outline" className={brandActionClass}>
            <Link href={backHref} prefetch={false}>{backLabel}</Link>
          </Button>
        </div>
        <p className="break-all text-xs text-muted-foreground">{trace}</p>
      </header>
    </div>
  );
}

export async function BrandDeletionPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("brands");
  const decision = await requireOpenIntake(user.email);
  if (decision.state === "closed") return closedBrandIntake(t);
  if (decision.state === "denied") return <DevActorDenied t={t} />;
  const intake = decision.intake;
  const { id } = await params;
  if (!brandIdSchema.safeParse(id).success) notFound();
  const href = "/dashboard/brands/" + id;
  const currentHref = href + "/delete";
  const result = await readDeletionPreview(user.id, id).catch(() => brandUnavailable());
  if ("unavailable" in result) return (
    <BrandScopeFailure
      title={t("deletionImpact")}
      message={t("unavailable")}
      trace={t("trace", { id: result.traceId })}
      reloadLabel={t("reload")}
      reloadHref={currentHref}
      backLabel={t("viewBrand")}
      backHref={href}
    />
  );
  if (!result.data) notFound();

  const impact = result.data;
  const messages = getMessages(locale);
  const rows = [
    [t("fieldName"), impact.name],
    [t("deletionBrandData"), t("deletionBrandCounts", { versions: formatNumber(locale, impact.versions), drafts: formatNumber(locale, impact.drafts) })],
    [messages.brandFacts.title, t("deletionFactCounts", { facts: formatNumber(locale, impact.facts), materials: formatNumber(locale, impact.materials) })],
    [messages.promptSets.title, t("deletionPromptCounts", { sets: formatNumber(locale, impact.promptSets) })],
    [t("deletionAttachments"), t("deletionUnavailableScope")],
    [t("deletionReports"), t("deletionUnavailableScope")],
    [t("deletionInFlight"), t("deletionInFlightCounts", { reservations: formatNumber(locale, impact.reservations), attempts: formatNumber(locale, impact.unresolvedAttempts) })],
    [t("deletionRetained"), t("deletionRetainedDetails")],
  ];
  const related = [
    { href, label: t("viewBrand") },
    { href: "/dashboard/brands", label: t("allBrands") },
    { href: href + "/facts", label: messages.brandFacts.title },
    { href: href + "/questions", label: messages.promptSets.title },
  ];
  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0 space-y-3">
        <h1 className="break-words text-2xl font-semibold tracking-tight">{t("deletionImpact")}</h1>
        <p className="max-w-3xl break-words text-sm leading-6 text-muted-foreground">{t("deletionTask")}</p>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{t("fieldName")}</span>
          <span className="[overflow-wrap:anywhere]">{impact.name}</span>
          <Badge variant="secondary">{t("active")}</Badge>
        </div>
        <BrandDeletionButtons action="freeze" id={id} revision={impact.revision} actorId={user.id} messages={messages.brands} />
        <nav aria-label={t("relatedEntries")} className="flex min-w-0 flex-wrap gap-2">
          {related.map((item) => (
            <Link key={item.href + item.label} href={item.href} prefetch={false} className={brandRelatedClass}>{item.label}</Link>
          ))}
        </nav>
      </header>
      <IntakeNotice t={t} mode={intake.mode} />
      <Card className="min-w-0 py-0 shadow-none">
        <CardContent className="space-y-5 p-5 sm:p-6">
          <p className="break-words text-sm leading-6">{t("deletionConsequences")}</p>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label} className="min-w-0 space-y-1 border-t pt-3">
                <dt className="font-medium">{label}</dt>
                <dd className="text-muted-foreground [overflow-wrap:anywhere]">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

export async function BrandRecoveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, session } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("brands");
  const email = await getTranslator("accountEmail");
  const decision = await requireOpenIntake(user.email);
  if (decision.state === "closed") return closedBrandIntake(t);
  if (decision.state === "denied") return <DevActorDenied t={t} />;
  const intake = decision.intake;
  const { id } = await params;
  if (!brandIdSchema.safeParse(id).success) notFound();
  const brandHref = "/dashboard/brands/" + id;
  const href = brandHref + "/recovery";
  const result = await readDeletionRecovery(user.id, id).catch(() => brandUnavailable());
  if ("unavailable" in result) return (
    <BrandScopeFailure
      title={t("recoveryTitle")}
      message={t("unavailable")}
      trace={t("trace", { id: result.traceId })}
      reloadLabel={t("reload")}
      reloadHref={href}
      backLabel={t("allBrands")}
      backHref="/dashboard/brands"
    />
  );
  if (!result.data?.frozenAt || !result.data.restoreUntil) notFound();
  const { frozenAt, restoreUntil, revision } = result.data;
  const error = brandRecoveryError({ frozenAt, restoreUntil },
    { emailVerified: user.emailVerified, createdAt: session.createdAt }, new Date());
  const task = error ? t(brandErrorMessage[error]) : t("recoveryTaskRestore");
  const primary = error === "IDENTITY_UNVERIFIED" ? (
    <Button asChild className={brandActionClass}>
      <Link href={accountAccessPath("verify", href)} prefetch={false}>{email("verifyTitle")}</Link>
    </Button>
  ) : error === "REAUTH_REQUIRED" ? (
    <SignOutButton returnTo={href} label={t("reauthenticate")} />
  ) : error === "RECOVERY_EXPIRED" ? (
    <Button asChild variant="outline" className={brandActionClass}>
      <Link href="/dashboard/brands" prefetch={false}>{t("allBrands")}</Link>
    </Button>
  ) : (
    <BrandDeletionButtons action="recover" id={id} revision={revision} actorId={user.id} messages={getMessages(locale).brands} />
  );
  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0 space-y-3">
        <h1 className="break-words text-2xl font-semibold tracking-tight">{t("recoveryTitle")}</h1>
        <p className="max-w-3xl break-words text-sm leading-6 text-muted-foreground">{task}</p>
        <Badge variant="outline">{t("frozenAccess")}</Badge>
        {primary}
        <nav aria-label={t("relatedEntries")} className="flex min-w-0 flex-wrap gap-2">
          <Link href="/dashboard/brands" prefetch={false} className={brandRelatedClass}>{t("allBrands")}</Link>
        </nav>
      </header>
      <IntakeNotice t={t} mode={intake.mode} />
      <Card className="min-w-0 py-0 shadow-none">
        <CardContent className="p-5 sm:p-6">
          <section aria-label={t("recoveryTitle")} className="min-w-0 space-y-4">
            <p className="break-words text-sm leading-6">{t("frozenDescription")}</p>
            <dl className="space-y-3 text-sm">
              <div className="min-w-0 space-y-1">
                <dt className="font-medium">{t("brandReference")}</dt>
                <dd className="text-muted-foreground [overflow-wrap:anywhere]">{id}</dd>
              </div>
              <div className="min-w-0 space-y-1">
                <dt className="font-medium">{t("recoveryDeadline")}</dt>
                <dd className="[overflow-wrap:anywhere]"><time dateTime={restoreUntil}>{formatDateTime(locale, new Date(restoreUntil))}</time></dd>
              </div>
            </dl>
            {error ? <p role="status" className="break-words text-sm leading-6">{t(brandErrorMessage[error])}</p> : null}
          </section>
        </CardContent>
      </Card>
    </div>
  );
}

export async function brandMetadata() {
  const t = await getTranslator("brands");
  return { title: t("title"), description: t("pageDescription"), robots: { index: false, follow: false } };
}

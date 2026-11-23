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
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { BrandForm } from "./brand-form";
import { BrandStatusButton } from "./brand-status-button";
import { brandRecoveryError } from "./commands";
import { archiveCursorSchema, brandIdSchema, brandVersionParam } from "./contracts";
import { BrandDeletionButtons } from "./deletion-buttons";
import { brandErrorMessage } from "./error-messages";
import { mockBrandFields } from "@/features/functional-mock/brand-profile";
import { brandIntakeOrigin, type BrandIntakeMode } from "./intake";
import { readPilotAdmission, type PilotAdmissionItem } from "./pilot-admission";
import { readBrandData } from "./service";

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
  return { label: "fixtureLabel", description: "fixtureDescription" } as const;
}

function IntakeNotice({ t, mode }: { t: Translate; mode: BrandIntakeMode }) {
  const copy = intakeCopy(mode);
  return (
    <aside className="max-w-3xl space-y-2 rounded-xl border bg-muted/50 p-4">
      <p className="text-sm font-semibold">{t(copy.label)}</p>
      <p className="text-sm leading-6 text-muted-foreground">{t(copy.description)}</p>
    </aside>
  );
}

function LocalObservationsLink({ t }: { t: Translate }) {
  return (
    <Link href="/dashboard/brands/local-observations" prefetch={false} className="inline-block text-sm underline underline-offset-4">
      {t("openLocalObservations")}
    </Link>
  );
}

function ClosedBrandIntake({ t, items }: { t: Translate; items: PilotAdmissionItem[] }) {
  return (
    <BrandFrame title={t("title")} back="/dashboard" backLabel={t("workspace")}>
      <LocalObservationsLink t={t} />
      <section className="max-w-3xl space-y-2 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">{t("closedTitle")}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{t("closedDescription")}</p>
      </section>
      <section aria-labelledby="pilot-admission" className="max-w-3xl space-y-3 rounded-xl border bg-card p-5">
        <h2 id="pilot-admission" className="font-semibold">{t("admissionTitle")}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{t("admissionDescription")}</p>
        <ul className="divide-y rounded-lg border">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <span>{t(admissionLabel[item.id])}</span>
              <span className="text-muted-foreground">{item.met ? t("admissionMet") : t("admissionUnmet")}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm leading-6 text-muted-foreground">{t("admissionRealIntakeClosed")}</p>
      </section>
    </BrandFrame>
  );
}

function closedBrandIntake(t: Translate) {
  return <ClosedBrandIntake t={t} items={readPilotAdmission(process.env).items} />;
}

function BrandLoadFailure({ t, href }: { t: Translate; href: string }) {
  return (
    <div role="alert" className="max-w-3xl space-y-3 rounded-xl border bg-card p-5">
      <p className="text-sm leading-6">{t("unavailable")}</p>
      <Button asChild variant="outline">
        <a href={href}>{t("reload")}</a>
      </Button>
    </div>
  );
}

export async function BrandIndexPage({ searchParams }: { searchParams: Promise<Query> }) {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("brands");
  const intake = brandIntakeOrigin(await headers());
  if (!intake) return closedBrandIntake(t);
  const query = await searchParams;
  const cursor = archiveCursorSchema.safeParse({ at: query.before, id: query.id });
  const frozenCursor = archiveCursorSchema.safeParse({ at: query.frozenBefore, id: query.frozenId });
  const result = await readBrandData(async (dao) => {
    const [active, archive, frozen] = await Promise.all([dao.active(user.id), dao.archived(user.id, cursor.data), dao.frozen(user.id, frozenCursor.data)]);
    return { active, archive, frozen };
  });
  return (
    <BrandFrame title={t("title")} back="/dashboard" backLabel={t("workspace")}>
      <IntakeNotice t={t} mode={intake.mode} />
      <LocalObservationsLink t={t} />
      {"unavailable" in result ? <BrandLoadFailure t={t} href="/dashboard/brands" /> : (
        <>
          <section aria-labelledby="brand-current" className="max-w-3xl rounded-xl border bg-card p-5 sm:p-6">
            <h2 id="brand-current" className="mb-3 font-semibold">{t("currentBrand")}</h2>
            {result.data.active ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="min-w-0 break-words text-lg">{result.data.active.name}</p>
                <Button asChild><Link href={"/dashboard/brands/" + result.data.active.id} prefetch={false}>{t("viewBrand")}</Link></Button>
              </div>
            ) : <Button asChild><Link href="/dashboard/brands/new" prefetch={false}>{t("newOrResume")}</Link></Button>}
          </section>
          <section aria-labelledby="brand-archived" className="max-w-3xl space-y-3">
            <h2 id="brand-archived" className="font-semibold">{t("archivedBrands")}</h2>
            {result.data.archive.items.length === 0 ? <p className="text-sm text-muted-foreground">{t("noArchived")}</p> : (
              <ul className="divide-y rounded-xl border bg-card">
                {result.data.archive.items.map((brand) => (
                  <li key={brand.id}>
                    <Link href={"/dashboard/brands/" + brand.id} prefetch={false} className="block rounded-sm p-4 text-sm break-words underline-offset-4 hover:underline">{brand.name}</Link>
                  </li>
                ))}
              </ul>
            )}
            {result.data.archive.next && (
              <Button asChild variant="outline">
                <Link href={{ pathname: "/dashboard/brands", query: { before: result.data.archive.next.at, id: result.data.archive.next.id,
                  frozenBefore: frozenCursor.data?.at, frozenId: frozenCursor.data?.id } }} prefetch={false}>
                  {t("olderBrands")}
                </Link>
              </Button>
            )}
          </section>
          <section aria-labelledby="brand-frozen" className="max-w-3xl space-y-3">
            <h2 id="brand-frozen" className="font-semibold">{t("frozenBrands")}</h2>
            {result.data.frozen.items.length === 0 ? <p className="text-sm text-muted-foreground">{t("noFrozenBrands")}</p> : (
              <ul className="divide-y rounded-xl border bg-card">
                {result.data.frozen.items.map((brand) => (
                  <li key={brand.id}>
                    <Link href={"/dashboard/brands/" + brand.id + "/recovery"} prefetch={false} className="block space-y-1 rounded-sm p-4 text-sm underline-offset-4 hover:underline">
                      <span className="block">{t("brandFrozenAt", { time: formatDateTime(locale, new Date(brand.frozenAt)) })}</span>
                      <span className="block break-all text-muted-foreground">{brand.id}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {result.data.frozen.next && (
              <Button asChild variant="outline">
                <Link href={{ pathname: "/dashboard/brands", query: { frozenBefore: result.data.frozen.next.at, frozenId: result.data.frozen.next.id,
                  before: cursor.data?.at, id: cursor.data?.id } }} prefetch={false}>
                  {t("olderFrozenBrands")}
                </Link>
              </Button>
            )}
          </section>
        </>
      )}
    </BrandFrame>
  );
}

export async function NewBrandPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("brands");
  const intake = brandIntakeOrigin(await headers());
  if (!intake) return closedBrandIntake(t);
  const result = await readBrandData(async (dao) => {
    const active = await dao.active(user.id);
    return { active, draft: active ? null : await dao.draft(user.id, "new") };
  });
  return (
    <BrandFrame title={t("createTitle")} back="/dashboard/brands" backLabel={t("allBrands")}>
      <IntakeNotice t={t} mode={intake.mode} />
      {"unavailable" in result ? <BrandLoadFailure t={t} href="/dashboard/brands/new" /> : result.data.active ? (
        <div className="max-w-3xl space-y-3 rounded-xl border bg-card p-5">
          <p role="status" className="text-sm leading-6">{t("limitReached")} {t("archiveFirst")}</p>
          <Button asChild><Link href={"/dashboard/brands/" + result.data.active.id} prefetch={false}>{t("viewBrand")}</Link></Button>
        </div>
      ) : <BrandForm key={user.id} actorId={user.id} draft={result.data.draft} target={null} messages={getMessages(locale).brands} mockProfile={intake.mode === "mock" ? mockBrandFields : undefined} />}
    </BrandFrame>
  );
}

export async function BrandDetailsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("brands");
  const intake = brandIntakeOrigin(await headers());
  if (!intake) return closedBrandIntake(t);
  const { id } = await params;
  const query = await searchParams;
  const version = brandVersionParam.safeParse(query.version);
  if (!brandIdSchema.safeParse(id).success || (query.version !== undefined && !version.success)) notFound();
  const href = "/dashboard/brands/" + id;
  const result = await readBrandData(async (dao) => {
    const brand = await dao.version(user.id, id, version.data);
    if (!brand) return null;
    const editing = query.edit === "1" && query.version === undefined && brand.status === "active";
    return { brand, editing, draft: editing ? await dao.draft(user.id, id) : null };
  });

  if ("unavailable" in result) {
    const retry = version.data ? href + "?version=" + version.data : query.edit === "1" ? href + "?edit=1" : href;
    return <BrandFrame title={t("title")} back="/dashboard/brands" backLabel={t("allBrands")}><BrandLoadFailure t={t} href={retry} /></BrandFrame>;
  }
  if (!result.data) notFound();
  const { brand, editing, draft } = result.data;
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
    { title: t("fieldWebsite"), values: [website || t("websiteNotApplicable")] },
    { title: t("fieldAliases"), values: aliases },
    { title: t("fieldRegion"), values: [regionName + " (" + region + ")"] },
    { title: t("fieldLanguage"), values: [languageName + " (" + language + ")"] },
    { title: t("fieldCompetitors"), values: competitors },
    { title: t("stepQuestions"), values: questions },
  ];
  return (
    <BrandFrame title={brand.fields.name} back="/dashboard/brands" backLabel={t("allBrands")}>
      <IntakeNotice t={t} mode={intake.mode} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="py-0 shadow-none">
          <CardContent className="space-y-5 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary"><Building2 aria-hidden="true" />{t("versionLabel", { version: formatNumber(locale, brand.version) })}</Badge>
              <Badge variant="outline">{t(brand.status)}</Badge>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">{t("updated", { time: formatDateTime(locale, new Date(brand.versionCreatedAt)) })}</p>
            {snapshot && <p className="text-sm font-medium">{t("historicalVersion")}</p>}
            <dl className="grid gap-4 sm:grid-cols-2">
              {rows.map(({ title, values }) => (
                <div className="min-w-0 space-y-1 border-t pt-3" key={title}>
                  <dt className="text-sm font-medium">{title}</dt>
                  {values.length > 1 ? (
                    <dd><ul className="list-inside list-disc space-y-1 text-sm leading-6 break-words text-muted-foreground">
                      {values.map((value, index) => <li key={index}>{value}</li>)}
                    </ul></dd>
                  ) : <dd className="text-sm leading-6 break-words whitespace-pre-wrap text-muted-foreground">{values[0] ?? t("emptyValue")}</dd>}
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <div className="space-y-4 rounded-xl border bg-card p-5">
          <p className="text-sm leading-6 text-muted-foreground">{t("monitorUnavailable")}</p>
          <div className="flex flex-wrap gap-2">
            {!snapshot && brand.status === "active" && <Button asChild><Link href={href + "?edit=1"} prefetch={false}>{t("edit")}</Link></Button>}
            {snapshot && <Button asChild><Link href={href} prefetch={false}>{t("currentVersion")}</Link></Button>}
            {brand.version > 1 && <Button asChild variant="outline"><Link href={href + "?version=" + (brand.version - 1)} prefetch={false}>{t("previousVersion")}</Link></Button>}
          </div>
          {!snapshot && <BrandStatusButton brand={{ id, status: brand.status, revision: brand.revision }} actorId={user.id} messages={messages} />}
          {!snapshot && <Button asChild variant="outline"><Link href={href + "/facts"} prefetch={false}>{getMessages(locale).brandFacts.title}</Link></Button>}
          {!snapshot && <Button asChild variant="outline"><Link href={href + "/questions"} prefetch={false}>{getMessages(locale).promptSets.title}</Link></Button>}
          {!snapshot && <Button asChild variant="outline"><Link href={href + "/entity-reviews"} prefetch={false}>{getMessages(locale).entityReviews.title}</Link></Button>}
          {!snapshot && <Button asChild variant="outline"><Link href={href + "/entity-corrections"} prefetch={false}>{getMessages(locale).entityCorrections.title}</Link></Button>}
          {!snapshot && <Button asChild variant="outline"><Link href={href + "/delete"} prefetch={false}>{t("reviewDeletion")}</Link></Button>}
        </div>
      </div>
    </BrandFrame>
  );
}

export async function BrandDeletionPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("brands");
  const intake = brandIntakeOrigin(await headers());
  if (!intake) return closedBrandIntake(t);
  const { id } = await params;
  if (!brandIdSchema.safeParse(id).success) notFound();
  const href = "/dashboard/brands/" + id;
  const result = await readBrandData((dao) => dao.deletionImpact(user.id, id));
  if ("unavailable" in result) return (
    <BrandFrame title={t("deletionImpact")} back={href} backLabel={t("viewBrand")}>
      <BrandLoadFailure t={t} href={href + "/delete"} />
    </BrandFrame>
  );
  if (!result.data) notFound();

  const impact = result.data;
  const rows = [
    [t("fieldName"), impact.name],
    [t("deletionBrandData"), t("deletionBrandCounts", { versions: formatNumber(locale, impact.versions), drafts: formatNumber(locale, impact.drafts) })],
    [getMessages(locale).brandFacts.title, t("deletionFactCounts", { facts: formatNumber(locale, impact.facts), materials: formatNumber(locale, impact.materials) })],
    [getMessages(locale).promptSets.title, t("deletionPromptCounts", { sets: formatNumber(locale, impact.promptSets) })],
    [t("deletionAttachments"), t("deletionUnavailableScope")],
    [t("deletionReports"), t("deletionUnavailableScope")],
    [t("deletionInFlight"), t("deletionInFlightCounts", { reservations: formatNumber(locale, impact.reservations), attempts: formatNumber(locale, impact.unresolvedAttempts) })],
    [t("deletionRetained"), t("deletionRetainedDetails")],
  ];
  return (
    <BrandFrame title={t("deletionImpact")} back={href} backLabel={t("viewBrand")}>
      <IntakeNotice t={t} mode={intake.mode} />
      <section aria-label={t("deletionImpact")} className="max-w-3xl space-y-5 rounded-xl border bg-card p-5">
        <p className="text-sm leading-6">{t("deletionConsequences")}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="min-w-0 space-y-1 border-t pt-3">
              <dt className="font-medium">{label}</dt>
              <dd className="wrap-anywhere text-muted-foreground">{value}</dd>
            </div>
          ))}
        </dl>
        <BrandDeletionButtons action="freeze" id={id} revision={impact.revision} actorId={user.id} messages={getMessages(locale).brands} />
      </section>
    </BrandFrame>
  );
}

export async function BrandRecoveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, session } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("brands");
  const email = await getTranslator("accountEmail");
  const intake = brandIntakeOrigin(await headers());
  if (!intake) return closedBrandIntake(t);
  const { id } = await params;
  if (!brandIdSchema.safeParse(id).success) notFound();
  const href = "/dashboard/brands/" + id + "/recovery";
  const result = await readBrandData((dao) => dao.deletionState(user.id, id));
  if ("unavailable" in result) return (
    <BrandFrame title={t("recoveryTitle")} back="/dashboard/brands" backLabel={t("allBrands")}>
      <BrandLoadFailure t={t} href={href} />
    </BrandFrame>
  );
  if (!result.data?.frozenAt || !result.data.restoreUntil) notFound();
  const { frozenAt, restoreUntil, revision } = result.data;
  const error = brandRecoveryError({ frozenAt, restoreUntil },
    { emailVerified: user.emailVerified, createdAt: session.createdAt }, new Date());
  return (
    <BrandFrame title={t("recoveryTitle")} back="/dashboard/brands" backLabel={t("allBrands")}>
      <IntakeNotice t={t} mode={intake.mode} />
      <section aria-label={t("recoveryTitle")} className="max-w-3xl space-y-4 rounded-xl border bg-card p-5">
        <p className="text-sm leading-6">{t("frozenDescription")}</p>
        <dl className="space-y-3 text-sm">
          <div><dt className="font-medium">{t("brandReference")}</dt><dd className="break-all">{id}</dd></div>
          <div><dt className="font-medium">{t("recoveryDeadline")}</dt>
            <dd><time dateTime={restoreUntil}>{formatDateTime(locale, new Date(restoreUntil))}</time></dd>
          </div>
        </dl>
        {error ? (
          <div className="space-y-3">
            <p role="status" className="text-sm leading-6">{t(brandErrorMessage[error])}</p>
            {error === "IDENTITY_UNVERIFIED" && (
              <Link href={accountAccessPath("verify", href)} prefetch={false}
                className="inline-block text-sm underline underline-offset-4">
                {email("verifyTitle")}
              </Link>
            )}
            {error === "REAUTH_REQUIRED" && <SignOutButton returnTo={href} label={t("reauthenticate")} />}
          </div>
        ) : <BrandDeletionButtons action="recover" id={id} revision={revision} actorId={user.id} messages={getMessages(locale).brands} />}
      </section>
    </BrandFrame>
  );
}

export async function brandMetadata() {
  const t = await getTranslator("brands");
  return { title: t("title"), description: t("pageDescription"), robots: { index: false, follow: false } };
}

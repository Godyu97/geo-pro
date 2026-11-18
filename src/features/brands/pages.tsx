import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/session";
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { BrandForm } from "./brand-form";
import { BrandStatusButton } from "./brand-status-button";
import { archiveCursorSchema, brandIdSchema, brandVersionParam } from "./contracts";
import { brandFixtureOrigin } from "./intake";
import { readBrandData } from "./service";

type Query = Record<string, string | string[] | undefined>;
type Translate = Awaited<ReturnType<typeof getTranslator<"brands">>>;

function BrandFrame({ title, back, backLabel, children }: { title: string; back: string; backLabel: string; children: ReactNode }) {
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <Link href={back} className="inline-flex items-center gap-2 rounded-sm text-sm text-muted-foreground underline-offset-4 hover:underline">
          <ArrowLeft aria-hidden="true" className="size-4" />
          {backLabel}
        </Link>
        <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      </header>
      {children}
    </div>
  );
}

function FixtureNotice({ t }: { t: Translate }) {
  return (
    <aside className="max-w-3xl space-y-2 rounded-xl border bg-muted/50 p-4">
      <p className="text-sm font-semibold">{t("fixtureLabel")}</p>
      <p className="text-sm leading-6 text-muted-foreground">{t("fixtureDescription")}</p>
    </aside>
  );
}

function ClosedBrandIntake({ t }: { t: Translate }) {
  return (
    <BrandFrame title={t("title")} back="/dashboard" backLabel={t("workspace")}>
      <section className="max-w-3xl space-y-2 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">{t("closedTitle")}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{t("closedDescription")}</p>
      </section>
    </BrandFrame>
  );
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
  const t = await getTranslator("brands");
  if (!brandFixtureOrigin(await headers())) return <ClosedBrandIntake t={t} />;
  const query = await searchParams;
  const cursor = archiveCursorSchema.safeParse({ at: query.before, id: query.id });
  const result = await readBrandData(async (dao) => {
    const [active, archive] = await Promise.all([dao.active(user.id), dao.archived(user.id, cursor.data)]);
    return { active, archive };
  });
  return (
    <BrandFrame title={t("title")} back="/dashboard" backLabel={t("workspace")}>
      <FixtureNotice t={t} />
      {"unavailable" in result ? <BrandLoadFailure t={t} href="/dashboard/brands" /> : (
        <>
          <section aria-labelledby="brand-current" className="max-w-3xl rounded-xl border bg-card p-5 sm:p-6">
            <h2 id="brand-current" className="mb-3 font-semibold">{t("currentBrand")}</h2>
            {result.data.active ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="min-w-0 break-words text-lg">{result.data.active.name}</p>
                <Button asChild><Link href={"/dashboard/brands/" + result.data.active.id}>{t("viewBrand")}</Link></Button>
              </div>
            ) : <Button asChild><Link href="/dashboard/brands/new">{t("newOrResume")}</Link></Button>}
          </section>
          <section aria-labelledby="brand-archived" className="max-w-3xl space-y-3">
            <h2 id="brand-archived" className="font-semibold">{t("archivedBrands")}</h2>
            {result.data.archive.items.length === 0 ? <p className="text-sm text-muted-foreground">{t("noArchived")}</p> : (
              <ul className="divide-y rounded-xl border bg-card">
                {result.data.archive.items.map((brand) => (
                  <li key={brand.id}>
                    <Link href={"/dashboard/brands/" + brand.id} className="block rounded-sm p-4 text-sm break-words underline-offset-4 hover:underline">{brand.name}</Link>
                  </li>
                ))}
              </ul>
            )}
            {result.data.archive.next && (
              <Button asChild variant="outline">
                <Link href={{ pathname: "/dashboard/brands", query: { before: result.data.archive.next.at, id: result.data.archive.next.id } }}>
                  {t("olderBrands")}
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
  if (!brandFixtureOrigin(await headers())) return <ClosedBrandIntake t={t} />;
  const result = await readBrandData(async (dao) => {
    const active = await dao.active(user.id);
    return { active, draft: active ? null : await dao.draft(user.id, "new") };
  });
  return (
    <BrandFrame title={t("createTitle")} back="/dashboard/brands" backLabel={t("allBrands")}>
      <FixtureNotice t={t} />
      {"unavailable" in result ? <BrandLoadFailure t={t} href="/dashboard/brands/new" /> : result.data.active ? (
        <div className="max-w-3xl space-y-3 rounded-xl border bg-card p-5">
          <p role="status" className="text-sm leading-6">{t("limitReached")} {t("archiveFirst")}</p>
          <Button asChild><Link href={"/dashboard/brands/" + result.data.active.id}>{t("viewBrand")}</Link></Button>
        </div>
      ) : <BrandForm key={user.id} actorId={user.id} draft={result.data.draft} target={null} messages={getMessages(locale).brands} />}
    </BrandFrame>
  );
}

export async function BrandDetailsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("brands");
  if (!brandFixtureOrigin(await headers())) return <ClosedBrandIntake t={t} />;
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
      <FixtureNotice t={t} />
      <BrandForm key={user.id + id} actorId={user.id} target={{ brandId: id, expectedBrandRevision: brand.revision }}
        current={brand.fields} draft={draft} messages={messages} />
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
      <FixtureNotice t={t} />
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
            {!snapshot && brand.status === "active" && <Button asChild><Link href={href + "?edit=1"}>{t("edit")}</Link></Button>}
            {snapshot && <Button asChild><Link href={href}>{t("currentVersion")}</Link></Button>}
            {brand.version > 1 && <Button asChild variant="outline"><Link href={href + "?version=" + (brand.version - 1)}>{t("previousVersion")}</Link></Button>}
          </div>
          {!snapshot && <BrandStatusButton brand={{ id, status: brand.status, revision: brand.revision }} actorId={user.id} messages={messages} />}
        </div>
      </div>
    </BrandFrame>
  );
}

export async function brandMetadata() {
  const t = await getTranslator("brands");
  return { title: t("title"), description: t("pageDescription"), robots: { index: false, follow: false } };
}

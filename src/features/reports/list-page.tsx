import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "@/features/brands/dao";
import { brandIntakeOrigin } from "@/features/brands/intake";
import { ApplyMockRetestButton } from "@/features/functional-mock/run-buttons";
import { listReports } from "./commands";
import { m0StageGate } from "./m0-stage-gate";
import type { ReportError } from "./contracts";

export async function generateMetadata() {
  const t = await getTranslator("reports");
  return { title: t("title") };
}

export default async function ReportsListPage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string }>;
}) {
  const session = await requireSession().catch(() => null);
  if (!session) redirect("/login");
  const t = await getTranslator("reports");
  const params = await searchParams;
  const brandId = params.brandId;
  if (!brandId) {
    return (
      <main id="main-content" className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("noBrand")}</p>
        <Link href="/dashboard/brands" prefetch={false} className="underline underline-offset-4">{t("goBrands")}</Link>
        <p className="flex flex-wrap gap-4">
          <Link href="/dashboard/reports/observations" prefetch={false} className="text-sm underline underline-offset-4">{t("openObservations")}</Link>
          <Link href="/dashboard/reports/leads" prefetch={false} className="text-sm underline underline-offset-4">{t("openLeads")}</Link>
          <Link href="/dashboard/reports/lead-quality" prefetch={false} className="text-sm underline underline-offset-4">{t("openLeadQuality")}</Link>
          <Link href="/dashboard/reports/lead-suggestions" prefetch={false} className="text-sm underline underline-offset-4">{t("openLeadSuggestions")}</Link>
        </p>
      </main>
    );
  }

  const brand = await new BrandDao(getConnection()).owned(session.user.id, brandId);
  if (!brand) {
    return (
      <main id="main-content" className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("NOT_FOUND")}</p>
      </main>
    );
  }

  const result = await listReports(getConnection(), session.user.id, brandId);
  const mockLane = brandIntakeOrigin(await headers())?.mode === "mock";
  const mockGate = m0StageGate({
    realBrand: false,
    officialAnswers: 0,
    consumerAnswers: 0,
    independentCompletions: 0,
  });
  const mockGateLabels: Record<string, string> = {
    real_brand: t("mockGateMissRealBrand"),
    official_api: t("mockGateMissOfficial"),
    consumer_manual: t("mockGateMissConsumer"),
    walkthrough: t("mockGateMissWalkthrough"),
  };
  if ("error" in result) {
    const code = result.error as ReportError;
    return (
      <main id="main-content" className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t(code)}</p>
      </main>
    );
  }

  return (
    <main id="main-content" className="mx-auto max-w-4xl space-y-8 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        <p className="flex flex-wrap gap-4">
          <Link href="/dashboard/reports/observations" prefetch={false} className="text-sm underline underline-offset-4">{t("openObservations")}</Link>
          <Link href="/dashboard/reports/leads" prefetch={false} className="text-sm underline underline-offset-4">{t("openLeads")}</Link>
          <Link href="/dashboard/reports/lead-quality" prefetch={false} className="text-sm underline underline-offset-4">{t("openLeadQuality")}</Link>
          <Link href="/dashboard/reports/lead-suggestions" prefetch={false} className="text-sm underline underline-offset-4">{t("openLeadSuggestions")}</Link>
        </p>
        {mockLane && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t("mockRetestNote")}</p>
            <ApplyMockRetestButton
              brandId={brandId}
              label={t("applyMockRetest")}
              pendingLabel={t("mockRetestPending")}
              doneLabel={t("mockRetestDone")}
              failedLabel={t("mockRetestFailed")}
            />
          </div>
        )}
      </header>

      <section className="space-y-3" aria-labelledby="retests-heading">
        <h2 id="retests-heading" className="text-lg font-medium">{t("retests")}</h2>
        {result.retests.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="space-y-2">
            {result.retests.map((item) => (
              <li key={item.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{item.kind} · {item.status} · {item.intent}</p>
                <p className="text-muted-foreground">{item.id}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="todos-heading">
        <h2 id="todos-heading" className="text-lg font-medium">{t("todos")}</h2>
        {result.todos.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("todosEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {result.todos.map((item) => (
              <li key={item.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{item.status} · due {item.dueAt}</p>
                <p className="text-muted-foreground">{t("noAutoCharge")}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="snapshots-heading">
        <h2 id="snapshots-heading" className="text-lg font-medium">{t("snapshots")}</h2>
        {result.snapshots.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("snapshotsEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {result.snapshots.map((item) => (
              <li key={item.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{item.grade} · {item.intent} · loop={item.loopCompleted ? "yes" : "no"}</p>
                <p className="text-muted-foreground">{item.status}{item.predecessorId ? ` · prev ${item.predecessorId}` : ""}</p>
                <p className="mt-2 flex flex-wrap gap-3">
                  <Link href={`/api/reports/snapshots/${item.id}?format=json`} prefetch={false} className="underline underline-offset-4">
                    {t("downloadJson")}
                  </Link>
                  <Link href={`/api/reports/snapshots/${item.id}?format=html`} prefetch={false} className="underline underline-offset-4">
                    {t("downloadHtml")}
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      {mockLane && (
        <section className="space-y-3" aria-labelledby="mock-gate-heading">
          <h2 id="mock-gate-heading" className="text-lg font-medium">{t("mockGateTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("mockGateNote")}</p>
          <p className="text-sm">{t("mockGateInputs")}</p>
          <p className="text-sm font-medium">{mockGate.passed ? t("mockGatePassed") : t("mockGateRefused")}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {mockGate.missing.map((code) => <li key={code}>{mockGateLabels[code] ?? code}</li>)}
          </ul>
          <p className="text-sm text-muted-foreground">{t("mockGateContract")}</p>
        </section>
      )}
    </main>
  );
}

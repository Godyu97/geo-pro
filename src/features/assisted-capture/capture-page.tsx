import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { CapturePanel } from "./capture-panel";
import { readCaptureWorkspace, type CaptureWorkspaceView } from "./commands";

const capturePath = "/dashboard/monitoring/capture";
const overviewPath = "/dashboard/monitoring/overview";
const knownErrors = ["NOT_FOUND", "INVALID_INPUT"] as const;
const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center";
const relatedLinkClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 whitespace-normal [overflow-wrap:anywhere] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function isKnownError(value: string | undefined): value is (typeof knownErrors)[number] {
  return knownErrors.some((code) => code === value);
}

export async function generateMetadata() {
  const t = await getTranslator("assistedCapture");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const locale = await getLocale();
  const t = await getTranslator("assistedCapture");
  const messages = getMessages(locale).assistedCapture;
  const errorCode = typeof params.error === "string" ? params.error : undefined;

  let workspace: CaptureWorkspaceView | null = null;
  let traceId: string | null = null;
  try {
    workspace = await readCaptureWorkspace(getConnection(), session.user.id);
  } catch {
    traceId = randomUUID();
    console.error("assisted-capture-page-unavailable", { traceId });
  }

  if (!workspace || "error" in workspace) {
    const alertText = !workspace ? t("SERVICE_UNAVAILABLE") : t(workspace.error);
    return (
      <div className="min-w-0 space-y-6">
        <header className="min-w-0 space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p role="alert" className="max-w-2xl text-sm leading-7 text-destructive">{alertText}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild className={actionClass}>
              <a href={capturePath}>{t("reload")}</a>
            </Button>
            <Button asChild variant="outline" className={actionClass}>
              <Link href={overviewPath} prefetch={false}>{t("backOverview")}</Link>
            </Button>
          </div>
          {traceId ? (
            <p className="break-all text-xs text-muted-foreground">{t("trace", { id: traceId })}</p>
          ) : null}
        </header>
      </div>
    );
  }

  const { brand, sheets } = workspace;

  if (!brand) {
    return (
      <div className="min-w-0 space-y-6">
        <header className="min-w-0 space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("description")}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild className={actionClass}>
              <Link href="/dashboard/brands" prefetch={false}>{t("openBrand")}</Link>
            </Button>
            <Button asChild variant="outline" className={actionClass}>
              <Link href={overviewPath} prefetch={false}>{t("backOverview")}</Link>
            </Button>
          </div>
          <nav aria-label={t("relatedEntries")} className="flex min-w-0 flex-wrap gap-2">
            <Link href="/dashboard/monitoring/plans" prefetch={false} className={relatedLinkClass}>
              {t("openPlans")}
            </Link>
            <Link href="/dashboard/monitoring/protocols" prefetch={false} className={relatedLinkClass}>
              {t("openProtocols")}
            </Link>
          </nav>
        </header>
        <p className="rounded-xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground">
          {t("noBrand")}
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("description")}</p>
        <div className="flex flex-wrap items-baseline gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{t("activeBrandLabel")}</span>
          <span className="[overflow-wrap:anywhere]">{brand.name}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {sheets.length > 0 ? (
            <>
              <Button asChild className={actionClass}>
                <a href="#capture-sheets">{t("browseSheets")}</a>
              </Button>
              <Button asChild variant="outline" className={actionClass}>
                <a href="#capture-create-heading">{t("startCreate")}</a>
              </Button>
            </>
          ) : (
            <Button asChild className={actionClass}>
              <a href="#capture-create-heading">{t("startCreate")}</a>
            </Button>
          )}
          <Button asChild variant="outline" className={actionClass}>
            <Link href={overviewPath} prefetch={false}>{t("backOverview")}</Link>
          </Button>
          <Button asChild variant="outline" className={actionClass}>
            <Link href={`/dashboard/brands/${brand.id}`} prefetch={false}>{t("viewBrand")}</Link>
          </Button>
        </div>
        <nav aria-label={t("relatedEntries")} className="flex min-w-0 flex-wrap gap-2">
          <Link href="/dashboard/monitoring/plans" prefetch={false} className={relatedLinkClass}>
            {t("openPlans")}
          </Link>
          <Link href="/dashboard/monitoring/protocols" prefetch={false} className={relatedLinkClass}>
            {t("openProtocols")}
          </Link>
          <Link href={`/dashboard/monitoring/new?brandId=${encodeURIComponent(brand.id)}`} prefetch={false} className={relatedLinkClass}>
            {t("openRunConfirm")}
          </Link>
        </nav>
      </header>
      <CapturePanel
        brandId={brand.id}
        sheets={sheets}
        initialError={isKnownError(errorCode) ? errorCode : null}
        messages={messages}
      />
    </div>
  );
}

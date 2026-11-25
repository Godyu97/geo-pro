import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { listSamplingProtocols } from "./protocol-commands.ts";
import { ProtocolsPanel } from "./protocols-panel";

const protocolsPath = "/dashboard/monitoring/protocols";
const overviewPath = "/dashboard/monitoring/overview";
const actionClass = "min-h-10 whitespace-normal text-center";

export async function generateMetadata() {
  const t = await getTranslator("samplingProtocols");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function SamplingProtocolsPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("samplingProtocols");
  const messages = getMessages(locale).samplingProtocols;
  const connection = getConnection();
  let workspace = null;
  try {
    workspace = await listSamplingProtocols(connection, user.id);
  } catch {
    console.error("sampling-protocols-page-unavailable");
  }
  if (!workspace) {
    return (
      <header className="min-w-0 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p role="alert" className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("SERVICE_UNAVAILABLE")}</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild className={actionClass}>
            <a href={protocolsPath}>{t("reload")}</a>
          </Button>
          <Button asChild variant="outline" className={actionClass}>
            <Link href={overviewPath} prefetch={false}>{t("backMonitoring")}</Link>
          </Button>
        </div>
      </header>
    );
  }
  const labels = await loadOwnedLabels(connection, workspace.brands.map((brand) => brand.id)).catch(() => []);
  return (
    <div className="min-w-0 space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("description")}</p>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("fixtureNote")}</p>
        <div className="flex flex-wrap gap-2">
          {workspace.brands.length === 0 ? (
            <Button asChild className={actionClass}>
              <Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link>
            </Button>
          ) : (
            <>
              <Button asChild className={actionClass}>
                <a href="#protocol-brand">{t("startDraft")}</a>
              </Button>
              {workspace.protocols.length > 0 && (
                <Button asChild variant="outline" className={actionClass}>
                  <a href="#protocol-families">{t("browseProtocols")}</a>
                </Button>
              )}
            </>
          )}
          <Button asChild variant="outline" className={actionClass}>
            <Link href={overviewPath} prefetch={false}>{t("backMonitoring")}</Link>
          </Button>
        </div>
      </header>
      <ProtocolsPanel
        brands={workspace.brands}
        protocols={workspace.protocols}
        pins={workspace.pins}
        labels={labels}
        messages={messages}
      />
    </div>
  );
}

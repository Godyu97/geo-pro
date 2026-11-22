import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import type { TeamLabel, TeamListView } from "./contracts.ts";
import { listTeamGrants, loadOwnedLabels } from "./commands.ts";
import { TeamPanel } from "./team-panel";

export async function generateMetadata() {
  const t = await getTranslator("teamAccess");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function TeamAccessPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("teamAccess");
  const messages = getMessages(locale).teamAccess;
  let workspace: TeamListView | null = null;
  let labels: TeamLabel[] = [];
  try {
    workspace = await listTeamGrants(getConnection(), user.id);
    labels = await loadOwnedLabels(getConnection(), workspace.ownerBrandIds);
  } catch {
    console.error("team-access-page-unavailable");
  }
  if (!workspace) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p role="alert" className="text-sm leading-6 text-destructive">{t("SERVICE_UNAVAILABLE")}</p>
        <Link href="/dashboard/settings" prefetch={false} className="inline-block text-sm underline underline-offset-4">{t("backSettings")}</Link>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("description")}</p>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("fixtureNote")}</p>
      </div>
      <TeamPanel labels={labels} workspace={workspace} messages={messages} />
      <Link href="/dashboard/settings" prefetch={false} className="inline-block text-sm underline underline-offset-4">{t("backSettings")}</Link>
    </div>
  );
}

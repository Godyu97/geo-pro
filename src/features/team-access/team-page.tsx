import Link from "next/link";
import { WorkspaceJump } from "@/components/layout/workspace-jump";
import { WorkspaceReadError, workspaceActionClass } from "@/components/layout/workspace-read-error";
import { Button } from "@/components/ui/button";
import { brandIdSchema } from "@/features/brands/contracts";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadTeamGroupWorkspace } from "./commands.ts";
import { TeamPanel } from "./team-panel";

const entry = "/dashboard/settings/team";
const settingsHref = "/dashboard/settings";

export async function generateMetadata() {
  const t = await getTranslator("teamAccess");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function TeamAccessPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireSession();
  const locale = await getLocale();
  const messages = getMessages(locale).teamAccess;
  const params = searchParams ? await searchParams : {};
  const rawGroupId = typeof params.groupId === "string" ? params.groupId.trim() : undefined;
  if (rawGroupId !== undefined && rawGroupId !== "" && !brandIdSchema.safeParse(rawGroupId).success) {
    return (
      <WorkspaceReadError
        title={messages.title}
        message={messages.FORBIDDEN}
        reloadHref={entry}
        backHref={settingsHref}
        backLabel={messages.backSettings}
        logEvent="team-access-invalid-group"
      />
    );
  }

  let loaded;
  try {
    const db = getConnection();
    loaded = await loadTeamGroupWorkspace(db, user.id, rawGroupId || undefined);
  } catch {
    return (
      <WorkspaceReadError
        title={messages.title}
        message={messages.SERVICE_UNAVAILABLE}
        reloadHref={entry}
        backHref={settingsHref}
        backLabel={messages.backSettings}
        logEvent="team-access-page-unavailable"
      />
    );
  }

  if ("error" in loaded) {
    return (
      <WorkspaceReadError
        title={messages.title}
        message={messages[loaded.error]}
        reloadHref={entry}
        backHref={settingsHref}
        backLabel={messages.backSettings}
        logEvent="team-access-group-denied"
      />
    );
  }

  const primary = loaded.ownerLabels.length > 0
    ? <WorkspaceJump href="#team-invite-user">{messages.invite}</WorkspaceJump>
    : <WorkspaceJump href="#invitations-heading">{messages.invitations}</WorkspaceJump>;
  return (
    <div className="min-w-0 space-y-6">
      <header className="min-w-0 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{messages.title}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{messages.description}</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild className={workspaceActionClass}>{primary}</Button>
          <Button asChild variant="outline" className={workspaceActionClass}>
            <Link href={settingsHref} prefetch={false}>{messages.backSettings}</Link>
          </Button>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{messages.fixtureNote}</p>
      </header>
      <TeamPanel view={loaded} messages={messages} />
    </div>
  );
}

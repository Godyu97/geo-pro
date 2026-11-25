import Link from "next/link";
import { WorkspaceJump } from "@/components/layout/workspace-jump";
import { WorkspaceReadError, workspaceActionClass } from "@/components/layout/workspace-read-error";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { ApprovalPolicyPanel } from "./approval-policy-panel";
import { listApprovalPolicies } from "./commands.ts";

const entry = "/dashboard/settings/approval-policy";
const settingsHref = "/dashboard/settings";

export async function generateMetadata() {
  const t = await getTranslator("approvalPolicy");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function ApprovalPolicyPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const messages = getMessages(locale).approvalPolicy;
  let loaded;
  try {
    const db = getConnection();
    const result = await listApprovalPolicies(db, user.id);
    const labels = await loadOwnedLabels(db, result.policies.map(({ brandId }) => brandId));
    loaded = { result, labels };
  } catch {
    return <WorkspaceReadError title={messages.title} message={messages.SERVICE_UNAVAILABLE} reloadHref={entry}
      backHref={settingsHref} backLabel={messages.backSettings} logEvent="approval-policy-page-unavailable" />;
  }

  const { result, labels } = loaded;
  const primary = result.policies.length > 0
    ? <WorkspaceJump href="#approval-policies">{messages.viewPolicies}</WorkspaceJump>
    : <Link href="/dashboard/brands" prefetch={false}>{messages.openBrands}</Link>;
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
      <ApprovalPolicyPanel labels={labels} policies={result.policies} messages={messages} />
    </div>
  );
}

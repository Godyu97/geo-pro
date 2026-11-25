import { WorkspaceLoading } from "@/components/layout/workspace-loading";
import { getTranslator } from "@/lib/i18n/server";

export default async function ApprovalPolicyLoading() {
  const t = await getTranslator("approvalPolicy");
  return <WorkspaceLoading label={t("loading")} />;
}

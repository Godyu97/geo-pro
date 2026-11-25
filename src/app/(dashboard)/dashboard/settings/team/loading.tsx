import { WorkspaceLoading } from "@/components/layout/workspace-loading";
import { getTranslator } from "@/lib/i18n/server";

export default async function TeamAccessLoading() {
  const t = await getTranslator("teamAccess");
  return <WorkspaceLoading label={t("loading")} />;
}

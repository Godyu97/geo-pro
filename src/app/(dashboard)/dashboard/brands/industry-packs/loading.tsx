import { WorkspaceLoading } from "@/components/layout/workspace-loading";
import { getTranslator } from "@/lib/i18n/server";

export default async function IndustryPacksLoading() {
  const t = await getTranslator("industryPacks");
  return <WorkspaceLoading label={t("loading")} />;
}

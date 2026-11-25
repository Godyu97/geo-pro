import { WorkspaceLoading } from "@/components/layout/workspace-loading";
import { getTranslator } from "@/lib/i18n/server";

export default async function ExplorationsLoading() {
  const t = await getTranslator("explorations");
  return <WorkspaceLoading label={t("loading")} />;
}

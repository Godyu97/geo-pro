import { WorkspaceLoading } from "@/components/layout/workspace-loading";
import { getTranslator } from "@/lib/i18n/server";

export default async function CapabilityMaintenanceLoading() {
  const t = await getTranslator("capabilities");
  return <WorkspaceLoading label={t("loading")} />;
}

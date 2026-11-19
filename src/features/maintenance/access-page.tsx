import Link from "next/link";
import { ArrowLeft, RefreshCw, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/session";
import { getTranslator } from "@/lib/i18n/server";
import { maintenancePermissions } from "./contracts";
import { currentMaintenanceAccess } from "./service";

export async function generateMetadata() {
  const t = await getTranslator("maintenance");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function MaintenanceAccessPage() {
  await requireSession();
  const result = await currentMaintenanceAccess();
  const t = await getTranslator("maintenance");
  return (
    <div className="space-y-7">
      <div>
        <ShieldCheck className="mb-4 size-7 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
      </div>
      <section aria-label={t("statusTitle")} className="rounded-xl border bg-card p-5 sm:p-6">
        <p role="status" className="font-medium">
          {t(result.status === "unavailable" ? "unavailable" : result.status === "allowed" ? "authorized" : "denied")}
        </p>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          {t(result.status === "unavailable" ? "retryDescription" : result.status === "allowed" ? "authorizedDescription" : "contactDescription")}
        </p>
        <p className="mt-4 break-all text-xs leading-6 text-muted-foreground">{t("trace", { id: result.traceId })}</p>
      </section>
      {result.status !== "unavailable" && (
        <section aria-label={t("permissionsTitle")} className="grid gap-4 lg:grid-cols-3">
          {maintenancePermissions.map((permission) => {
            const granted = result.status === "allowed" && result.data.permissions.includes(permission);
            return (
              <Card key={permission} className="min-w-0 shadow-none">
                <CardContent className="space-y-4 p-5">
                  <h2 className="break-words font-medium">{t(permission)}</h2>
                  <Badge variant="outline" className="max-w-full whitespace-normal">{t(granted ? "granted" : "notGranted")}</Badge>
                  <p className="text-sm leading-7 text-muted-foreground">{t(
                    permission === "quotas.manage" && granted ? "quotaOperationsAvailable"
                      : permission === "capabilities.manage" && granted ? "capabilityOperationsAvailable"
                        : "operationsPending",
                  )}</p>
                  {permission === "capabilities.manage" && granted && (
                    <Button asChild variant="outline" className="h-auto min-h-10 whitespace-normal py-2">
                      <Link href="/dashboard/maintenance/capabilities">{t("openCapabilities")}</Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}
      <p className="text-sm leading-7 text-muted-foreground">{t("privacyBoundary")}</p>
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline" className="h-auto min-h-10 whitespace-normal py-2">
          <a href="/dashboard/maintenance"><RefreshCw aria-hidden="true" />{t("refresh")}</a>
        </Button>
        <Button asChild variant="outline" className="h-auto min-h-10 whitespace-normal py-2">
          <Link href="/dashboard"><ArrowLeft aria-hidden="true" />{t("back")}</Link>
        </Button>
      </div>
    </div>
  );
}

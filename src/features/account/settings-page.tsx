import { Suspense } from "react";
import Link from "next/link";
import { headers } from "next/headers";

import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { Card, CardContent } from "@/components/ui/card";
import { brandFixtureOrigin } from "@/features/brands/intake";
import { DataExportPanel } from "@/features/data-exports/settings-panel";
import { MonitoringCapabilityPanel } from "@/features/capabilities/settings-panel";
import { PilotQuotaPanel } from "@/features/quotas/settings-panel";
import { requireSession } from "@/lib/auth/session";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { ProfileForm } from "./profile-form";
import { accountAccessPath } from "./email/contracts";
import { hasVerifiedEmail } from "@/lib/auth/verified-email";

export async function generateMetadata() {
  const t = await getTranslator("common");
  return { title: t("accountSettings"), robots: { index: false, follow: false } };
}

export default async function AccountSettingsPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("settings");
  const common = await getTranslator("common");
  const quota = await getTranslator("quotas");
  const capabilities = await getTranslator("capabilities");
  const email = await getTranslator("accountEmail");
  const brandManagementAvailable = Boolean(brandFixtureOrigin(await headers()));
  const emailVerified = hasVerifiedEmail(user);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{common("accountSettings")}</h1>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="profile-heading" className="min-w-0">
          <Card className="py-0 shadow-none">
            <CardContent className="space-y-5 p-5 sm:p-6">
              <h2 id="profile-heading" className="text-base font-semibold">{t("profile")}</h2>
              <dl className="space-y-1">
                <dt className="font-medium">{t("email")}</dt>
                <dd className="break-all text-muted-foreground">{user.email}</dd>
              </dl>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                <span className="text-muted-foreground">{email(emailVerified ? "verifiedLabel" : "unverifiedLabel")}</span>
                {!emailVerified && (
                  <Link href={accountAccessPath("verify", "/dashboard/settings")} prefetch={false}
                    className="underline underline-offset-4">
                    {email("verifyTitle")}
                  </Link>
                )}
              </div>
              <ProfileForm
                key={user.id}
                userId={user.id}
                name={user.name}
                messages={getMessages(locale).settings}
              />
            </CardContent>
          </Card>
        </section>

        <div className="grid gap-4">
          <section aria-labelledby="language-heading" className="space-y-3 rounded-xl border bg-card p-5">
            <h2 id="language-heading" className="font-medium">{common("language")}</h2>
            <div className="flex">
              <LanguageSwitcher />
            </div>
          </section>
          <section id="security" aria-labelledby="security-heading" className="space-y-3 rounded-xl border bg-card p-5">
            <h2 id="security-heading" className="font-medium">{t("security")}</h2>
            <div className="flex">
              <SignOutButton />
            </div>
          </section>
          <section id="monitoring-capabilities" aria-labelledby="capability-heading" className="min-w-0 space-y-3 rounded-xl border bg-card p-5">
            <h2 id="capability-heading" className="font-medium">{capabilities("title")}</h2>
            <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">{capabilities("loading")}</p>}>
              <MonitoringCapabilityPanel locale={locale} />
            </Suspense>
          </section>
          <section id="pilot-quotas" aria-labelledby="quota-heading" className="min-w-0 space-y-3 rounded-xl border bg-card p-5">
            <h2 id="quota-heading" className="font-medium">{quota("title")}</h2>
            <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">{quota("loading")}</p>}>
              <PilotQuotaPanel ownerId={user.id} locale={locale} />
            </Suspense>
          </section>
          <section id="team-access" aria-labelledby="team-heading" className="min-w-0 space-y-3 rounded-xl border bg-card p-5">
            <h2 id="team-heading" className="font-medium">{t("teamAccess")}</h2>
            <Link href="/dashboard/settings/team" prefetch={false} className="text-sm underline underline-offset-4">{t("openTeam")}</Link>
          </section>
          <section id="approval-policy" aria-labelledby="approval-policy-heading" className="min-w-0 space-y-3 rounded-xl border bg-card p-5">
            <h2 id="approval-policy-heading" className="font-medium">{t("approvalPolicy")}</h2>
            <Link href="/dashboard/settings/approval-policy" prefetch={false} className="text-sm underline underline-offset-4">{t("openApprovalPolicy")}</Link>
          </section>
          <section id="external-connections" aria-labelledby="external-connections-heading" className="min-w-0 space-y-3 rounded-xl border bg-card p-5">
            <h2 id="external-connections-heading" className="font-medium">{t("externalConnections")}</h2>
            <Link href="/dashboard/settings/connections" prefetch={false} className="text-sm underline underline-offset-4">{t("openExternalConnections")}</Link>
          </section>
          <section id="notification-endpoints" aria-labelledby="notification-endpoints-heading" className="min-w-0 space-y-3 rounded-xl border bg-card p-5">
            <h2 id="notification-endpoints-heading" className="font-medium">{t("notificationEndpoints")}</h2>
            <Link href="/dashboard/settings/notifications" prefetch={false} className="text-sm underline underline-offset-4">{t("openNotificationEndpoints")}</Link>
          </section>
          <section id="data-management" aria-labelledby="data-heading" className="min-w-0 space-y-3 rounded-xl border bg-card p-5">
            <h2 id="data-heading" className="font-medium">{t("dataManagement")}</h2>
            <DataExportPanel userId={user.id} locale={locale} />
            {brandManagementAvailable ? (
              <Link href="/dashboard/brands" prefetch={false} className="text-sm underline underline-offset-4">{t("manageBrandDeletion")}</Link>
            ) : <p className="text-sm leading-6 text-muted-foreground">{t("dataDeletionStatus")}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

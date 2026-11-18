import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { Card, CardContent } from "@/components/ui/card";
import { DataExportPanel } from "@/features/data-exports/settings-panel";
import { requireSession } from "@/lib/auth/session";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { ProfileForm } from "./profile-form";

export async function generateMetadata() {
  const t = await getTranslator("common");
  return { title: t("accountSettings"), robots: { index: false, follow: false } };
}

export default async function AccountSettingsPage() {
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("settings");
  const common = await getTranslator("common");

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
          <section id="data-management" aria-labelledby="data-heading" className="min-w-0 space-y-3 rounded-xl border bg-card p-5">
            <h2 id="data-heading" className="font-medium">{t("dataManagement")}</h2>
            <DataExportPanel userId={user.id} locale={locale} />
            <p className="text-sm leading-6 text-muted-foreground">{t("dataDeletionStatus")}</p>
          </section>
        </div>
      </div>
    </div>
  );
}

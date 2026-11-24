import { ArrowDown, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { headers } from "next/headers";

import { getModuleLinks, workspaceEntryHrefs } from "@/components/layout/module-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { requireSession } from "@/lib/auth/session";
import { MonitoringCapabilityPanel } from "@/features/capabilities/settings-panel";
import { brandIntakeDecision } from "@/features/brands/intake";
import { WorkspaceHomePanel } from "@/features/evidence/workspace-home-panel.tsx";

export default async function DashboardPage() {
  // Each protected page checks the session, including RSC navigation requests.
  const { user } = await requireSession();
  const locale = await getLocale();
  const t = await getTranslator("dashboard");
  const brands = await getTranslator("brands");
  const decision = brandIntakeDecision(await headers(), user.email);
  const intake = decision.state === "open" ? decision.intake : null;
  const brandDenied = decision.state === "denied";
  const brandFixture = intake?.mode === "fixture";
  const brandReal = intake?.mode === "real";
  const brandMock = intake?.mode === "mock";
  let brandStatus = t("unavailable");
  let brandDescription: string | null = null;
  if (brandDenied) {
    brandStatus = brands("devDeniedStatus");
    brandDescription = brands("devActorDeniedDescription");
  } else if (brandFixture) {
    brandStatus = brands("fixtureStatus");
  } else if (brandReal) {
    brandStatus = brands("realStatus");
    brandDescription = brands("realDescription");
  } else if (brandMock) {
    brandStatus = brands("mockStatus");
    brandDescription = brands("mockDescription");
  } else if (intake?.mode === "dev") {
    brandStatus = brands("devStatus");
    brandDescription = brands("devDescription");
  }
  const moduleLinks = getModuleLinks(getMessages(locale).modules);

  return (
    <div className="space-y-9">
      <section className="rounded-2xl border bg-secondary/55 p-6 sm:p-8">
        <Badge variant="outline" className="mb-5 gap-1.5 bg-white/60">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          {t("connected")}
        </Badge>
        <h1 className="break-words text-2xl leading-relaxed font-semibold tracking-tight sm:text-3xl">
          {t("greeting", { name: user.name })}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
          {t("welcome")}
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button asChild><Link href="/dashboard/brands" prefetch={false}>{brands("title")}</Link></Button>
          <Button asChild variant="outline" className="bg-white/70">
            <a href="#modules">
              {t("moduleStatus")}
              <ArrowDown aria-hidden="true" />
            </a>
          </Button>
        </div>
      </section>
      <WorkspaceHomePanel ownerId={user.id} />
      <section aria-labelledby="channels-title" className="max-w-3xl space-y-3 rounded-2xl border bg-card p-6">
        <h2 id="channels-title" className="text-lg font-semibold">{t("channelsTitle")}</h2>
        <p className="text-sm leading-7 text-muted-foreground">{t("channelsDescription")}</p>
        <MonitoringCapabilityPanel locale={locale} />
      </section>
      <section id="modules" aria-labelledby="modules-title">
        <h2 id="modules-title" className="mb-5 text-lg font-semibold">
          {t("workspaceModules")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {moduleLinks.map(({ id, title, icon: Icon, description }) => {
            return (
              <Card key={id} id={id} className="scroll-mt-6 shadow-none">
                <CardContent className="p-6">
                  <div className="mb-5 flex items-center justify-between">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    {id === "brands" && (
                      <Badge variant="outline" className="font-normal text-muted-foreground">{brandStatus}</Badge>
                    )}
                  </div>
                  <h3 className="font-medium">{title}</h3>
                  <p className="mt-2 min-h-14 text-sm leading-7 text-muted-foreground">
                    {id === "brands" ? brandDescription ?? description : description}
                  </p>
                  <Link href={workspaceEntryHrefs[id]} prefetch={false} className="mt-5 inline-flex border-t pt-4 text-sm font-medium underline-offset-4 hover:underline">
                    {t("openEntry", { title })}
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}

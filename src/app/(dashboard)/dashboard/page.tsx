import { ArrowDown, Leaf, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { headers } from "next/headers";

import { getModuleLinks } from "@/components/layout/module-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { requireSession } from "@/lib/auth/session";
import { MonitoringCapabilityPanel } from "@/features/capabilities/settings-panel";
import { brandIntakeDecision } from "@/features/brands/intake";
import { WorkspaceHomePanel } from "@/features/evidence/workspace-home-panel.tsx";
import { workspaceEntryHrefs } from "@/features/evidence/workspace-home.ts";

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
  let moduleStatus = t("unavailable");
  let moduleDescription: string | null = null;
  if (brandDenied) {
    moduleStatus = brands("devDeniedStatus");
    moduleDescription = brands("devActorDeniedDescription");
  } else if (brandFixture) {
    moduleStatus = brands("fixtureStatus");
    moduleDescription = brands("pageDescription");
  } else if (brandReal) {
    moduleStatus = brands("realStatus");
    moduleDescription = brands("realDescription");
  } else if (brandMock) {
    moduleStatus = brands("mockStatus");
    moduleDescription = brands("mockDescription");
  } else if (intake?.mode === "dev") {
    moduleStatus = brands("devStatus");
    moduleDescription = brands("devDescription");
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
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 id="modules-title" className="text-lg font-semibold">
            {t("workspaceModules")}
          </h2>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Leaf className="size-3.5 text-primary" aria-hidden="true" />
            {t("improving")}
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {moduleLinks.map(({ id, title, icon: Icon, description, empty }) => {
            const brandEntry = id === "brands" && Boolean(intake);
            const href = moduleHref(id);
            return (
              <Card key={id} id={id} className="scroll-mt-6 shadow-none">
                <CardContent className="p-6">
                  <div className="mb-5 flex items-center justify-between">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <Badge variant="outline" className="font-normal text-muted-foreground">
                      {moduleStatus}
                    </Badge>
                  </div>
                  <h3 className="font-medium">{title}</h3>
                  <p className="mt-2 min-h-14 text-sm leading-7 text-muted-foreground">
                    {moduleDescription ?? description}
                  </p>
                  {href ? (
                    <Link href={href} prefetch={false} className="mt-5 inline-flex border-t pt-4 text-sm font-medium underline-offset-4 hover:underline">
                      {t("openEntry", { title })}
                    </Link>
                  ) : !brandEntry ? (
                    <p className="mt-5 border-t pt-4 text-xs text-muted-foreground">{empty}</p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function moduleHref(id: string) {
  switch (id) {
    case "brands":
    case "monitoring":
    case "optimization":
    case "content":
    case "reports":
      return workspaceEntryHrefs[id];
    default:
      return null;
  }
}

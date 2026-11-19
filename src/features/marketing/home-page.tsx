import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Check,
  CircleDot,
  FileCheck2,
  Quote,
  Radar,
  Route,
  UserRound,
} from "lucide-react";

import { BrandMark } from "@/components/layout/brand-mark";
import { getModuleLinks } from "@/components/layout/module-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { getSessionState } from "@/lib/auth/session";
import { readPublicCapabilities } from "@/features/capabilities/service";

export async function MarketingHomePage() {
  const { status } = await getSessionState();
  const authenticated = status === "authenticated";
  const accountUnavailable = status === "not-configured" || status === "unavailable";
  const locale = await getLocale();
  const t = await getTranslator("marketing");
  const common = await getTranslator("common");
  const moduleLinks = getModuleLinks(getMessages(locale).modules);
  const publicCapabilities = await readPublicCapabilities();
  const entryHref = authenticated ? "/dashboard" : "/login?mode=signup";
  const entryLabel = authenticated ? t("continue") : accountUnavailable ? t("accountEntry") : t("start");
  const availability = [
    { icon: UserRound, title: t("accountTitle"), description: t("accountDescription"), status: t("foundation") },
    { icon: Building2, title: t("brandTitle"), description: t("brandDescription"), status: t("preparing") },
    {
      icon: Radar,
      title: t("monitoringTitle"),
      description: publicCapabilities.items.length ? t("monitoringVerifiedDescription") : t("monitoringDescription"),
      status: t("preparing"),
    },
  ];
  const steps = [
    {
      icon: CircleDot,
      title: t("stepQuestionTitle"),
      description: t("stepQuestionDescription"),
    },
    {
      icon: Quote,
      title: t("stepEvidenceTitle"),
      description: t("stepEvidenceDescription"),
    },
    {
      icon: FileCheck2,
      title: t("stepActionTitle"),
      description: t("stepActionDescription"),
    },
    {
      icon: Route,
      title: t("stepRetestTitle"),
      description: t("stepRetestDescription"),
    },
  ];

  return (
    <>
      <header className="border-b bg-background/95">
        <nav
          aria-label={t("nav")}
          className="mx-auto flex min-h-20 max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8"
        >
          <BrandMark />
          <div className="order-last flex w-full flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground sm:order-none sm:w-auto">
            <a href="#capabilities" className="rounded hover:text-foreground">{t("capabilities")}</a>
            <a href="#availability" className="rounded hover:text-foreground">{t("availabilityNav")}</a>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LanguageSwitcher />
            <Button asChild variant={authenticated ? "default" : "ghost"}>
              <Link href={authenticated ? "/dashboard" : "/login"}>
                {authenticated ? t("console") : accountUnavailable ? t("accountEntry") : common("login")}
              </Link>
            </Button>
          </div>
        </nav>
      </header>
      <main id="main-content">
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div>
            <Badge variant="secondary" className="mb-6 gap-2 px-3 py-1.5">
              <span className="size-1.5 rounded-full bg-primary" />
              {t("audience")}
            </Badge>
            <h1 className="max-w-xl text-4xl leading-[1.25] font-semibold tracking-tight sm:text-5xl">
              {t("heroTitle")}
              <br />
              <span className="text-primary">{t("heroAccent")}</span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-8 text-muted-foreground">
              {t("heroDescription")}
            </p>
            <p className="mt-4 max-w-lg text-sm leading-7 text-muted-foreground">
              {t("audienceDescription")}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href={entryHref}>
                  {entryLabel}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <a href="#capabilities">{t("direction")}</a>
              </Button>
            </div>
            <p className="mt-5 text-sm leading-6 text-muted-foreground" role={accountUnavailable ? "status" : undefined}>
              {status === "not-configured" ? t("accountNotConfigured") : status === "unavailable" ? t("accountUnavailable") : t("availability")}
            </p>
            <div className="mt-9 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
              {[t("principleEvidence"), t("principleUnknown"), t("principleRanking")].map(
                (text) => (
                  <span key={text} className="flex items-center gap-1.5">
                    <Check
                      className="size-3.5 text-primary"
                      aria-hidden="true"
                    />
                    {text}
                  </span>
                ),
              )}
            </div>
          </div>
          <div className="rounded-3xl border bg-card p-5 shadow-[0_18px_65px_-30px_#537a7838] sm:p-7">
            <div className="mb-7 flex items-center justify-between border-b pb-5">
              <span className="text-sm font-medium">{t("stepsTitle")}</span>
              <Badge variant="outline">{t("directionBadge")}</Badge>
            </div>
            <ol className="space-y-5">
              {steps.map(({ icon: Icon, title, description }, index) => (
                <li key={title} className="flex items-center gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-secondary text-primary">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{title}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {description}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    0{index + 1}
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-7 rounded-xl border border-dashed bg-muted/50 px-4 py-3 text-xs leading-6 text-muted-foreground">
              {t("noCases")}
            </div>
          </div>
        </section>
        <section id="availability" aria-labelledby="availability-title" className="scroll-mt-8 border-t bg-secondary/40">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
            <h2 id="availability-title" className="text-2xl font-semibold tracking-tight">{t("availabilityTitle")}</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground">{t("availabilityDescription")}</p>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {availability.map(({ icon: Icon, title, description, status: label }) => (
                <Card key={title} className="shadow-none">
                  <CardContent className="p-6">
                    <Icon className="mb-5 size-5 text-primary" aria-hidden="true" />
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <h3 className="font-medium">{title}</h3>
                      <Badge variant="secondary">{label}</Badge>
                    </div>
                    <p className="text-sm leading-7 text-muted-foreground">{description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            {publicCapabilities.items.length > 0 && (
              <ul className="mt-4 grid gap-3 md:grid-cols-2">
                {publicCapabilities.items.map((item) => (
                  <li key={item.channelId} className="rounded-xl border bg-card p-4 text-sm leading-7">
                    <p className="font-medium wrap-anywhere">{item.displayName}</p>
                    <p className="text-muted-foreground wrap-anywhere">{item.kind} · {item.productEntry}</p>
                    <p className="text-muted-foreground wrap-anywhere">{item.limitsSummary}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-6 rounded-xl border bg-card p-6">
              <h3 className="font-medium">{t("pilotTitle")}</h3>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">{t("pilotDescription")}</p>
            </div>
          </div>
        </section>
        <section id="capabilities" className="scroll-mt-8 border-y bg-white/55">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
            <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mb-3 text-xs font-medium tracking-[0.2em] text-primary">
                  {t("evidenceLabel")}
                </p>
                <h2 className="text-2xl font-semibold tracking-tight">
                  {t("capabilitiesTitle")}
                </h2>
              </div>
              <p className="text-sm text-muted-foreground">
                {t("planned")}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {moduleLinks.map(({ id, title, icon: Icon, description }) => (
                <Card key={id} className="shadow-none">
                  <CardContent className="p-6">
                    <Icon
                      className="mb-5 size-5 text-primary"
                      aria-hidden="true"
                    />
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="font-medium">{title}</h3>
                      <span className="text-xs text-muted-foreground">
                        {t("preparing")}
                      </span>
                    </div>
                    <p className="text-sm leading-7 text-muted-foreground">
                      {description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>
      </main>
      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-xs text-muted-foreground sm:px-8">
        <p>{t("footerEvidence")}</p>
        <p>{t("footerAvailability")}</p>
      </footer>
    </>
  );
}

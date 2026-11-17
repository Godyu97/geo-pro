import Link from "next/link";
import {
  ArrowRight,
  Check,
  CircleDot,
  FileCheck2,
  Quote,
  Route,
} from "lucide-react";

import { BrandMark } from "@/components/layout/brand-mark";
import { getModuleLinks } from "@/components/layout/module-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";

export default async function HomePage() {
  const locale = await getLocale();
  const t = await getTranslator("marketing");
  const common = await getTranslator("common");
  const moduleLinks = getModuleLinks(getMessages(locale).modules);
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
          <a
            href="#capabilities"
            className="hidden rounded text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
          >
            {t("capabilities")}
          </a>
          <div className="flex flex-wrap items-center gap-2">
            <LanguageSwitcher />
            <Button asChild variant="ghost">
              <Link href="/login">{common("login")}</Link>
            </Button>
            <Button asChild>
              <Link href="/dashboard">
                {t("console")}
                <ArrowRight aria-hidden="true" />
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
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/login?mode=signup">
                  {t("start")}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <a href="#capabilities">{t("direction")}</a>
              </Button>
            </div>
            <p className="mt-5 text-sm leading-6 text-muted-foreground">
              {t("availability")}
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

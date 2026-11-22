import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao";
import { listLeadSuggestions, type LeadSuggestionView } from "./suggestion-commands";
import { DraftLeadSuggestionsForm, LeadSuggestionActions } from "./suggestion-form";

const knownErrors = ["NOT_FOUND", "INVALID_INPUT", "AI_UNAVAILABLE", "CONFLICT"] as const;

function isKnownError(value: string | undefined): value is (typeof knownErrors)[number] {
  return knownErrors.some((code) => code === value);
}

export async function generateMetadata() {
  const t = await getTranslator("leadSuggestions");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function LeadSuggestionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const locale = await getLocale();
  const t = await getTranslator("leadSuggestions");
  const messages = getMessages(locale).leadSuggestions;
  const errorCode = typeof params.error === "string" ? params.error : undefined;
  const connection = getConnection();
  const active = await new BrandDao(connection).active(session.user.id);
  const statusLabel = {
    draft: t("statusDraft"),
    accepted: t("statusAccepted"),
    discarded: t("statusDiscarded"),
  } as const;

  if (!active) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>
        <Button asChild><Link href="/dashboard/brands" prefetch={false}>{t("openBrand")}</Link></Button>
      </div>
    );
  }

  const listed = await listLeadSuggestions(connection, session.user.id, active.id);
  const suggestions: LeadSuggestionView[] = "error" in listed ? [] : listed.suggestions;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/dashboard/reports/leads" prefetch={false}>{t("openLeads")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard/reports/lead-quality" prefetch={false}>{t("openQuality")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/dashboard/reports?brandId=${active.id}`} prefetch={false}>{t("backReports")}</Link>
          </Button>
        </div>
      </div>

      {isKnownError(errorCode) ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(errorCode)}</p>
      ) : null}
      {"error" in listed && listed.error ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(listed.error)}</p>
      ) : null}

      <p className="text-sm text-muted-foreground">{active.name}</p>
      <DraftLeadSuggestionsForm locale={locale} messages={messages} brandId={active.id} />

      {suggestions.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{t("questionsHeading")}</h2>
          {suggestions.map((suggestion) => (
            <article key={suggestion.id} className="space-y-3 rounded-2xl border p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className="text-sm">{statusLabel[suggestion.status]}</p>
                <p className="text-sm text-muted-foreground">{t("modelLine", { model: suggestion.modelName })}</p>
              </div>
              {suggestion.ignored ? <p className="text-sm">{t("ignored")}</p> : null}
              <ul className="space-y-2 text-sm">
                {suggestion.questions.map((question) => (
                  <li key={question.text} className="space-y-1">
                    <p>{question.text}</p>
                    <p className="text-muted-foreground">{t("notFrozen")}</p>
                  </li>
                ))}
              </ul>
              {suggestion.status === "draft" ? (
                <LeadSuggestionActions locale={locale} messages={messages} suggestionId={suggestion.id} />
              ) : null}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

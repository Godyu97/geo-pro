import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao";
import { listLeadSuggestions } from "./suggestion-commands";
import { DraftLeadSuggestionsForm, LeadSuggestionReview } from "./suggestion-form";

const knownErrors = ["NOT_FOUND", "INVALID_INPUT", "AI_UNAVAILABLE", "CONFLICT"] as const;
const suggestionsPath = "/dashboard/reports/lead-suggestions";
const reportsPath = "/dashboard/reports";
const summaryId = "lead-suggestion-summary";
const actionClass = "h-auto min-h-10 max-w-full py-2 whitespace-normal";
const summaryClass = "max-w-2xl text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]";

function isKnownError(value: string | undefined): value is (typeof knownErrors)[number] {
  return knownErrors.some((code) => code === value);
}

async function readWorkspace(ownerId: string) {
  try {
    const connection = getConnection();
    const brand = await new BrandDao(connection).active(ownerId);
    if (!brand) return { kind: "noBrand" } as const;
    const listed = await listLeadSuggestions(connection, ownerId, brand.id);
    if ("error" in listed) return { kind: "error", code: listed.error } as const;
    return { kind: "ready", brand, suggestions: listed.suggestions } as const;
  } catch {
    console.error("lead-suggestions-page-read-unavailable");
    return { kind: "error", code: "SERVICE_UNAVAILABLE" } as const;
  }
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
  const workspace = await readWorkspace(session.user.id);
  const ready = workspace.kind === "ready" ? workspace : null;
  const pending = ready?.suggestions.find((suggestion) => suggestion.status === "draft");
  const needsBrand = workspace.kind === "noBrand" || (workspace.kind === "error" && workspace.code === "NOT_FOUND");

  return (
    <div className="min-w-0 space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        {ready ? <p className={summaryClass}>{ready.brand.name}</p> : null}
        {workspace.kind === "error" ? (
          <p role="alert" className={summaryClass}>{t(workspace.code)}</p>
        ) : (
          <p className={summaryClass}>{t(workspace.kind === "noBrand" ? "noBrand" : "description")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {needsBrand ? (
            <Button asChild className={actionClass}>
              <Link href="/dashboard/brands" prefetch={false}>{t("openBrand")}</Link>
            </Button>
          ) : null}
          {workspace.kind === "error" && !needsBrand ? (
            <Button asChild className={actionClass}><a href={suggestionsPath}>{t("reload")}</a></Button>
          ) : null}
          {ready ? (
            <>
              <Button asChild className={actionClass}>
                <a href={pending ? `#lead-suggestion-${pending.id}` : `#${summaryId}`}>
                  {t(pending ? "reviewDraft" : "writeSummary")}
                </a>
              </Button>
              <Button asChild variant="outline" className={actionClass}>
                <Link href="/dashboard/reports/leads" prefetch={false}>{t("openLeads")}</Link>
              </Button>
              <Button asChild variant="outline" className={actionClass}>
                <Link href="/dashboard/reports/lead-quality" prefetch={false}>{t("openQuality")}</Link>
              </Button>
            </>
          ) : null}
          <Button asChild variant="outline" className={actionClass}>
            <Link href={ready ? `${reportsPath}?brandId=${ready.brand.id}` : reportsPath} prefetch={false}>
              {t("backReports")}
            </Link>
          </Button>
        </div>
      </header>

      {ready ? (
        <div key={ready.brand.id} className="space-y-6">
          {isKnownError(errorCode) ? (
            <p role="alert" className="rounded-xl border bg-card px-4 py-3 text-sm">{t(errorCode)}</p>
          ) : null}
          {ready.suggestions.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-card px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <section aria-labelledby="lead-suggestions-heading" className="space-y-4">
              <h2 id="lead-suggestions-heading" className="text-lg font-semibold">{t("questionsHeading")}</h2>
              {ready.suggestions.map((suggestion) => (
                <LeadSuggestionReview
                  key={suggestion.id}
                  locale={locale}
                  messages={messages}
                  suggestionId={suggestion.id}
                  status={suggestion.status}
                  modelName={suggestion.modelName}
                >
                  {suggestion.ignored ? <p className="text-sm">{t("ignored")}</p> : null}
                  <ul className="space-y-2 text-sm">
                    {suggestion.questions.map((question, index) => (
                      <li key={index} className="space-y-1">
                        <p>{question.text}</p>
                        <p className="text-muted-foreground">{t("notFrozen")}</p>
                      </li>
                    ))}
                  </ul>
                </LeadSuggestionReview>
              ))}
            </section>
          )}
          <DraftLeadSuggestionsForm locale={locale} messages={messages} brandId={ready.brand.id} summaryId={summaryId} />
        </div>
      ) : null}
    </div>
  );
}

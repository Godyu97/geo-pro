import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { getConnection } from "@/lib/db/connection";
import { formatNumber } from "@/lib/i18n/format";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao";
import { draftStrategyTemplateAction, saveStrategyTemplateAction } from "./strategy-actions";
import { listStrategyTemplates, type StrategyTemplateView } from "./strategy-commands";

const knownErrors = ["NOT_FOUND", "INVALID_INPUT", "AI_UNAVAILABLE", "AI_FAILED", "INVALID_MODEL_OUTPUT"] as const;
const inputClass = "h-10 w-full rounded-md border bg-background px-3";
const textClass = "min-h-28 w-full rounded-md border bg-background px-3 py-2";

function isKnownError(value: string | undefined): value is (typeof knownErrors)[number] {
  return knownErrors.some((code) => code === value);
}

export async function generateMetadata() {
  const t = await getTranslator("strategyTemplates");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function StrategyTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const locale = await getLocale();
  const t = await getTranslator("strategyTemplates");
  const errorCode = typeof params.error === "string" ? params.error : undefined;
  const connection = getConnection();
  const active = await new BrandDao(connection).active(session.user.id);
  const strengthLabel = {
    single_observation: t("single_observation"),
    repeated_observation: t("repeated_observation"),
    insufficient: t("insufficient"),
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

  const listed = await listStrategyTemplates(connection, session.user.id, active.id);
  const templates: StrategyTemplateView[] = "error" in listed ? [] : listed.templates;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">{t("fixtureNote")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/dashboard/assistant" prefetch={false}>{t("backAssistant")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard" prefetch={false}>{t("backOverview")}</Link>
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

      <form action={saveStrategyTemplateAction} className="grid gap-4 rounded-2xl border p-5 sm:grid-cols-2">
        <h2 className="text-lg font-semibold sm:col-span-2">{t("saveTitle")}</h2>
        <input type="hidden" name="brandId" value={active.id} />
        <label className="space-y-2 text-sm">
          <span>{t("industry")}</span>
          <input name="industry" required maxLength={120} className={inputClass} />
        </label>
        <label className="space-y-2 text-sm">
          <span>{t("successes")}</span>
          <input name="successes" type="number" required min={0} max={1000000} inputMode="numeric" className={`${inputClass} tabular-nums`} />
        </label>
        <label className="space-y-2 text-sm sm:col-span-2">
          <span>{t("samplingCondition")}</span>
          <textarea name="samplingCondition" required maxLength={500} className={textClass} />
        </label>
        <label className="space-y-2 text-sm">
          <span>{t("evidenceStrength")}</span>
          <select name="evidenceStrength" required defaultValue="single_observation" className={inputClass}>
            <option value="single_observation">{t("single_observation")}</option>
            <option value="repeated_observation">{t("repeated_observation")}</option>
            <option value="insufficient">{t("insufficient")}</option>
          </select>
        </label>
        <label className="space-y-2 text-sm sm:col-span-2">
          <span>{t("failureCase")}</span>
          <textarea name="failureCase" required maxLength={2000} className={textClass} />
        </label>
        <label className="space-y-2 text-sm sm:col-span-2">
          <span>{t("explanation")}</span>
          <textarea name="explanation" required maxLength={4000} className={textClass} />
        </label>
        <div className="sm:col-span-2">
          <Button type="submit">{t("save")}</Button>
        </div>
      </form>

      <form action={draftStrategyTemplateAction} className="grid gap-4 rounded-2xl border p-5 sm:grid-cols-2">
        <h2 className="text-lg font-semibold sm:col-span-2">{t("draftTitle")}</h2>
        <input type="hidden" name="brandId" value={active.id} />
        <label className="space-y-2 text-sm">
          <span>{t("industry")}</span>
          <input name="industry" required maxLength={120} className={inputClass} />
        </label>
        <label className="space-y-2 text-sm">
          <span>{t("successes")}</span>
          <input name="successes" type="number" required min={0} max={1000000} inputMode="numeric" className={`${inputClass} tabular-nums`} />
        </label>
        <label className="space-y-2 text-sm sm:col-span-2">
          <span>{t("samplingCondition")}</span>
          <textarea name="samplingCondition" required maxLength={500} className={textClass} />
        </label>
        <label className="space-y-2 text-sm">
          <span>{t("evidenceStrength")}</span>
          <select name="evidenceStrength" required defaultValue="single_observation" className={inputClass}>
            <option value="single_observation">{t("single_observation")}</option>
            <option value="repeated_observation">{t("repeated_observation")}</option>
            <option value="insufficient">{t("insufficient")}</option>
          </select>
        </label>
        <label className="space-y-2 text-sm sm:col-span-2">
          <span>{t("failureCase")}</span>
          <textarea name="failureCase" required maxLength={2000} className={textClass} />
        </label>
        <label className="space-y-2 text-sm sm:col-span-2">
          <span>{t("materials")}</span>
          <textarea name="materials" required maxLength={4000} className={textClass} />
          <span className="block text-muted-foreground">{t("materialsHint")}</span>
        </label>
        <div className="sm:col-span-2">
          <Button type="submit">{t("draft")}</Button>
        </div>
      </form>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">{t("listHeading")}</h2>
        {templates.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
        ) : templates.map((template) => (
          <article key={template.id} className="space-y-3 rounded-2xl border p-5">
            <h3 className="text-base font-semibold break-words">{template.industry}</h3>
            <p className="text-sm leading-7 break-words">{template.samplingCondition}</p>
            <p className="text-sm">{strengthLabel[template.evidenceStrength]}</p>
            <p className="text-sm">{t("observation")}</p>
            <p className="text-sm">{t("notGuaranteed")}</p>
            <p className="text-sm tabular-nums">{t("successLine", { count: formatNumber(locale, template.successes) })}</p>
            <p className="text-sm leading-7 break-words">{template.failureCase}</p>
            <p className="text-sm leading-7 break-words">{template.explanation}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

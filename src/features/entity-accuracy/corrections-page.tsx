import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { confirmDisambiguationAction, recordCorrectionAction } from "./actions";
import type { EntityRevisionBoard } from "./revisions";
import { listEntityRevisions } from "./revisions";

const knownErrors = ["disambiguationInvalid", "correctionInvalid", "NOT_FOUND", "SERVICE_UNAVAILABLE"] as const;

function isKnownError(value: string | undefined): value is (typeof knownErrors)[number] {
  return knownErrors.some((code) => code === value);
}

function actionKey(action: EntityRevisionBoard["corrections"][number]["action"]) {
  if (action === "actioned") return "actionActioned" as const;
  return "actionOpen" as const;
}

function effectKey(effect: EntityRevisionBoard["corrections"][number]["effect"]) {
  if (effect === "unresolved") return "effectUnresolved" as const;
  if (effect === "pending_retest") return "effectPendingRetest" as const;
  return "effectOpen" as const;
}

export async function generateMetadata() {
  const t = await getTranslator("entityCorrections");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function EntityCorrectionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const brandId = brandIdSchema.safeParse(id);
  if (!brandId.success) notFound();
  const t = await getTranslator("entityCorrections");
  const errorCode = typeof query.error === "string" ? query.error : undefined;
  let listed: { board: EntityRevisionBoard } | { error: "NOT_FOUND" | "SERVICE_UNAVAILABLE" };
  try {
    const result = await listEntityRevisions(getConnection(), session.user.id, brandId.data);
    listed = "error" in result ? { error: "NOT_FOUND" } : { board: result.board };
  } catch {
    listed = { error: "SERVICE_UNAVAILABLE" };
  }
  if ("error" in listed && listed.error === "NOT_FOUND") notFound();
  const board = "board" in listed ? listed.board : null;
  const href = `/dashboard/brands/${brandId.data}`;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        </div>
        <Button asChild variant="outline">
          <Link href={href} prefetch={false}>{t("back")}</Link>
        </Button>
      </div>

      {isKnownError(errorCode) ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(errorCode)}</p>
      ) : null}
      {"error" in listed ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(listed.error)}</p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("disambiguationTitle")}</h2>
        {board && board.disambiguations.length > 0 ? (
          <ul className="space-y-3">
            {board.disambiguations.map((row) => (
              <li className="space-y-1 rounded-2xl border p-4 text-sm leading-6" key={row.id}>
                <p>{t("priorVersion", { id: row.priorAnalysisId })}</p>
                <p>{t("nextVersion", { id: row.nextAnalysisId })}</p>
                <p>{row.countAsTargetMention ? t("mentionCounted") : t("mentionExcluded")}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("emptyDisambiguation")}</p>
        )}
        <form action={confirmDisambiguationAction} className="grid gap-3 rounded-2xl border p-5 sm:grid-cols-2">
          <p className="text-sm leading-7 text-muted-foreground sm:col-span-2">{t("disambiguationHint")}</p>
          <input type="hidden" name="brandId" value={brandId.data} />
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("observationId")}</span>
            <input name="observationId" required className="w-full rounded-md border bg-background px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("priorAnalysisId")}</span>
            <input name="priorAnalysisId" required className="w-full rounded-md border bg-background px-3 py-2" />
          </label>
          <div className="flex flex-wrap items-end gap-4 text-sm sm:col-span-2">
            <label className="flex items-center gap-2">
              <input name="sameSurfaceName" type="checkbox" />
              {t("sameSurfaceName")}
            </label>
            <label className="flex items-center gap-2">
              <input name="confirmedDifferentEntity" type="checkbox" />
              {t("confirmedDifferentEntity")}
            </label>
          </div>
          <div>
            <Button type="submit">{t("saveDisambiguation")}</Button>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("correctionTitle")}</h2>
        {board && board.corrections.length > 0 ? (
          <ul className="space-y-3">
            {board.corrections.map((row) => (
              <li className="rounded-2xl border p-4" key={row.id}>
                <p className="mb-3 text-sm text-muted-foreground">{row.observationId}</p>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm text-muted-foreground">{t("actionHeading")}</dt>
                    <dd className="text-sm font-medium">{t(actionKey(row.action))}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">{t("effectHeading")}</dt>
                    <dd className="text-sm font-medium">{t(effectKey(row.effect))}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("emptyCorrection")}</p>
        )}
        <form action={recordCorrectionAction} className="grid gap-3 rounded-2xl border p-5 sm:grid-cols-2">
          <p className="text-sm leading-7 text-muted-foreground sm:col-span-2">{t("correctionHint")}</p>
          <input type="hidden" name="brandId" value={brandId.data} />
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-muted-foreground">{t("observationId")}</span>
            <input name="observationId" required className="w-full rounded-md border bg-background px-3 py-2" />
          </label>
          <div className="flex flex-wrap items-end gap-4 text-sm sm:col-span-2">
            <label className="flex items-center gap-2">
              <input name="actionDone" type="checkbox" />
              {t("actionDone")}
            </label>
            <label className="flex items-center gap-2">
              <input name="retestStillWrong" type="checkbox" />
              {t("retestStillWrong")}
            </label>
          </div>
          <div>
            <Button type="submit">{t("saveCorrection")}</Button>
          </div>
        </form>
      </section>
    </div>
  );
}

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao";
import { createFormalObservationAction, recordFormalCheckpointAction } from "./actions";
import { listFormalObservations, type FormalObservationView } from "./commands";

const knownErrors = ["NOT_FOUND", "INVALID_INPUT"] as const;
const inputClass = "h-10 w-full rounded-md border bg-background px-3";

function isKnownError(value: string | undefined): value is (typeof knownErrors)[number] {
  return knownErrors.some((code) => code === value);
}

function digits(value: number) {
  return String(value);
}

export async function generateMetadata() {
  const t = await getTranslator("formalObservations");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function FormalObservationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const t = await getTranslator("formalObservations");
  const errorCode = typeof params.error === "string" ? params.error : undefined;
  const connection = getConnection();
  const active = await new BrandDao(connection).active(session.user.id);
  const modeLabel = {
    progress: t("modeProgress"),
    formal: t("modeFormal"),
    exploratory: t("modeExploratory"),
  } as const;
  const conclusionLabel = {
    progress: t("conclusionEmpty"),
    formal: t("conclusionFormal"),
    exploratory: t("conclusionExploratory"),
  } as const;
  const checkpointLabel = { d7: t("checkpointD7"), d14: t("checkpointD14"), d28: t("checkpointD28") } as const;
  const statusLabel = { observing: t("statusObserving"), checkpoint_due: t("statusCheckpointDue") } as const;

  if (!active) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>
        <Button asChild><Link href="/dashboard/brands" prefetch={false}>{t("openBrand")}</Link></Button>
      </div>
    );
  }

  const listed = await listFormalObservations(connection, session.user.id, active.id);
  const observations: FormalObservationView[] = "error" in listed ? [] : listed.observations;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/dashboard/reports?brandId=${active.id}`} prefetch={false}>{t("backReports")}</Link>
        </Button>
      </div>

      {isKnownError(errorCode) ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(errorCode)}</p>
      ) : null}
      {"error" in listed && listed.error ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-3 text-sm">{t(listed.error)}</p>
      ) : null}

      <p className="text-sm text-muted-foreground">{active.name}</p>

      <form action={createFormalObservationAction} className="grid gap-4 rounded-2xl border p-5 sm:grid-cols-2">
        <h2 className="text-lg font-semibold sm:col-span-2">{t("createTitle")}</h2>
        <input type="hidden" name="brandId" value={active.id} />
        <label className="space-y-2 text-sm">
          <span>{t("frozenSetId")}</span>
          <input name="frozenSetId" required maxLength={64} className={inputClass} />
        </label>
        <label className="space-y-2 text-sm">
          <span>{t("effectiveOn")}</span>
          <input name="effectiveOn" type="date" required className={inputClass} />
        </label>
        <label className="space-y-2 text-sm">
          <span>{t("frozenCount")}</span>
          <input name="frozenNonBrandCount" type="number" required min={1} max={500} inputMode="numeric" className={`${inputClass} tabular-nums`} />
        </label>
        <div className="flex items-end">
          <Button type="submit">{t("create")}</Button>
        </div>
      </form>

      {observations.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
      ) : observations.map((observation) => (
        <section key={observation.id} className="space-y-5 rounded-2xl border p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">{observation.frozenSetId}</h2>
            <p className="text-sm">{statusLabel[observation.status]}</p>
          </div>
          <p className="text-sm tabular-nums">{t("effectiveLine", { date: observation.effectiveOn })}</p>
          <p className="text-sm tabular-nums">{t("frozenLine", { count: digits(observation.frozenNonBrandCount) })}</p>

          <form action={recordFormalCheckpointAction} className="grid gap-4 sm:grid-cols-2">
            <h3 className="text-base font-semibold sm:col-span-2">{t("checkpointTitle")}</h3>
            <input type="hidden" name="observationId" value={observation.id} />
            <label className="space-y-2 text-sm">
              <span>{t("checkpoint")}</span>
              <select name="checkpoint" required className={inputClass} defaultValue="d14">
                <option value="d7">{checkpointLabel.d7}</option>
                <option value="d14">{checkpointLabel.d14}</option>
                <option value="d28">{checkpointLabel.d28}</option>
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span>{t("today")}</span>
              <input name="today" type="date" required className={inputClass} />
              <span className="block text-muted-foreground">{t("todayHint")}</span>
            </label>
            <label className="space-y-2 text-sm">
              <span>{t("comparable")}</span>
              <input name="comparableQuestions" type="number" required min={0} max={500} inputMode="numeric" className={`${inputClass} tabular-nums`} />
            </label>
            <label className="space-y-2 text-sm sm:col-span-2">
              <span>{t("excluded")}</span>
              <textarea name="excluded" className="min-h-24 w-full rounded-md border bg-background px-3 py-2" />
              <span className="block text-muted-foreground">{t("excludedHint")}</span>
            </label>
            <div>
              <Button type="submit">{t("requestFormal")}</Button>
            </div>
          </form>

          <div className="space-y-3">
            {observation.checkpoints.length === 0 ? null : (
              <>
                <h3 className="text-base font-semibold">{t("history")}</h3>
                {observation.checkpoints.map((checkpoint) => (
                  <article key={checkpoint.id} className="space-y-2 rounded-xl border border-dashed p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <p className="text-sm font-medium">{checkpointLabel[checkpoint.checkpoint]}</p>
                      <p className="text-sm">{modeLabel[checkpoint.mode]}</p>
                    </div>
                    <p className="text-sm tabular-nums">{t("comparableLine", {
                      comparable: digits(checkpoint.comparableCount),
                      frozen: digits(observation.frozenNonBrandCount),
                    })}</p>
                    <p className="text-sm tabular-nums">{t("evaluatedLine", { date: checkpoint.evaluatedOn })}</p>
                    <p className="text-sm leading-7">{conclusionLabel[checkpoint.mode]}</p>
                    <div>
                      <p className="text-sm font-medium">{t("excludedHeading")}</p>
                      {checkpoint.excluded.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t("noExcluded")}</p>
                      ) : (
                        <ul className="mt-1 space-y-1 text-sm">
                          {checkpoint.excluded.map((id, index) => (
                            <li key={`${checkpoint.id}-${index}`} className="tabular-nums">{id}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </article>
                ))}
              </>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

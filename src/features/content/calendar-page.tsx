import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { Button } from "@/components/ui/button";
import { brandIdSchema } from "../brands/contracts";
import { BrandDao } from "../brands/dao";
import { scanExpiredMaintenanceAction, settleMaintenanceAction } from "./actions";
import { calendarQuerySchema } from "./contracts";
import { readContentCalendar } from "./maintenance";

export async function generateMetadata() {
  const t = await getTranslator("content");
  return { title: t("calendarTitle"), robots: { index: false, follow: false } };
}

const actionClass = "h-auto max-w-full whitespace-normal";
const relatedClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 break-words whitespace-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const emptyClass = "rounded-xl border border-dashed px-4 py-5 text-sm leading-6 text-muted-foreground";

type CalendarPageRow = {
  pageId: string;
  pageUrl: string;
  channel: string;
  plannedOn: string | null;
  verifiedOn: string | null;
  status: "planned" | "verified" | "blocked";
  published: boolean;
};

function CalendarCanvas({
  title,
  summary,
  primary,
  relatedLabel,
  related,
  children,
}: {
  title: string;
  summary?: ReactNode;
  primary?: ReactNode;
  relatedLabel: string;
  related: ReadonlyArray<{ href: string; label: string }>;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-8">
      <header className="min-w-0 space-y-3">
        <h1 className="break-words text-2xl font-semibold tracking-tight">{title}</h1>
        {summary}
        {primary}
        {related.length > 0 ? (
          <nav aria-label={relatedLabel} className="flex min-w-0 flex-wrap gap-2">
            {related.map((item) => (
              <Link key={item.href} href={item.href} prefetch={false} className={relatedClass}>
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>
      {children}
    </div>
  );
}

function nextMaintenance(pages: CalendarPageRow[]) {
  const planned = pages.find((page) => page.status === "planned");
  if (planned) return { kind: "planned" as const, page: planned };
  const blocked = pages.find((page) => page.status === "blocked");
  if (blocked) return { kind: "blocked" as const, page: blocked };
  if (pages.length > 0) return { kind: "verified" as const, page: null };
  return { kind: "empty" as const, page: null };
}

export default async function ContentCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const t = await getTranslator("content");
  const connection = getConnection();
  const active = await new BrandDao(connection).active(session.user.id);
  const requested = typeof params.brandId === "string" ? params.brandId : active?.id;
  const brandsAction = (
    <Button asChild className={actionClass}>
      <Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link>
    </Button>
  );
  if (!requested || !brandIdSchema.safeParse(requested).success) {
    return (
      <CalendarCanvas
        title={t("calendarTitle")}
        summary={<p className="max-w-2xl break-words text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>}
        primary={brandsAction}
        relatedLabel={t("relatedEntries")}
        related={[]}
      />
    );
  }

  const contentHref = `/dashboard/content?brandId=${encodeURIComponent(requested)}`;
  const factsHref = `/dashboard/brands/${requested}/facts`;
  const calendarHref = `/dashboard/content/calendar?brandId=${encodeURIComponent(requested)}`;
  const requestedFact = typeof params.factVersionId === "string" ? params.factVersionId : undefined;
  const parsedQuery = calendarQuerySchema.safeParse({
    brandId: requested,
    ...(requestedFact ? { factVersionId: requestedFact } : {}),
  });
  if (!parsedQuery.success) notFound();
  let calendar: Awaited<ReturnType<typeof readContentCalendar>>;
  try {
    calendar = await readContentCalendar(connection, session.user.id, parsedQuery.data);
  } catch {
    console.error("content-calendar-read-failed", { brandId: requested });
    calendar = { error: "SERVICE_UNAVAILABLE" };
  }
  if ("error" in calendar) {
    if (calendar.error === "NOT_FOUND") notFound();
    return (
      <CalendarCanvas
        title={t("calendarTitle")}
        summary={<p role="alert" className="max-w-2xl break-words text-sm leading-7">{t("calendarUnavailable")}</p>}
        primary={(
          <Button asChild className={actionClass}>
            <a href={calendarHref}>{t("reload")}</a>
          </Button>
        )}
        relatedLabel={t("relatedEntries")}
        related={[{ href: contentHref, label: t("backToContent") }]}
      />
    );
  }

  const statusLabel = {
    planned: t("maintenancePlanned"),
    verified: t("maintenanceVerified"),
    blocked: t("maintenanceBlocked"),
  } as const;
  const reasonLabel = {
    expired: t("calendarReasonExpired"),
    revoked: t("calendarReasonRevoked"),
    mismatch: t("calendarReasonMismatch"),
    removed: t("calendarReasonRemoved"),
  } as const;
  const calendarErrorCodes = ["NOT_FOUND", "INVALID_INPUT", "FACT_INVALID", "OPERATION_CONFLICT"] as const;
  const calendarError = calendarErrorCodes.find((code) => code === params.calendarError);
  const scanned = typeof params.scanned === "string" && /^\d{1,4}$/.test(params.scanned) ? Number(params.scanned) : null;
  const feedback = calendarError ? (
    <p role="alert" className="break-words text-sm leading-7">{t(calendarError)}</p>
  ) : params.calendarNotice === "settled" ? (
    <p role="status" className="break-words text-sm leading-7 text-muted-foreground">{t("settleSaved")}</p>
  ) : params.calendarNotice === "scanned" && scanned !== null ? (
    <p role="status" className="break-words text-sm leading-7 text-muted-foreground">{t("scanExpiredDone", { count: scanned })}</p>
  ) : null;
  const pages = calendar.tasks.flatMap((task) => task.pages);
  const next = nextMaintenance(pages);
  const taskCopy = {
    planned: t("calendarTaskPlanned"),
    blocked: t("calendarTaskBlocked"),
    verified: t("calendarTaskVerified"),
    empty: t("calendarTaskEmpty"),
  }[next.kind];
  const primary = next.page ? (
    <Button asChild className={actionClass}>
      <Link
        href={`/dashboard/content/publications/${next.page.pageId}`}
        prefetch={false}
      >
        {next.kind === "planned" ? t("calendarOpenPlanned") : t("calendarOpenBlocked")}
      </Link>
    </Button>
  ) : (
    <Button asChild className={actionClass}>
      <Link href={contentHref} prefetch={false}>{t("backToContent")}</Link>
    </Button>
  );
  const related = [
    { href: contentHref, label: t("backToContent") },
    { href: factsHref, label: t("brandFactsLink") },
  ].filter((item) => next.page || item.href !== contentHref);

  return (
    <CalendarCanvas
      title={t("calendarTitle")}
      summary={(
        <div className="max-w-2xl space-y-2">
          <p role="status" className="break-words text-sm leading-7 text-muted-foreground">{taskCopy}</p>
          <p className="break-words text-sm leading-7 text-muted-foreground">{t("calendarDescription")}</p>
          {feedback}
        </div>
      )}
      primary={primary}
      relatedLabel={t("relatedEntries")}
      related={related}
    >
      <form action={scanExpiredMaintenanceAction} className="flex min-w-0 flex-wrap gap-2">
        <input type="hidden" name="brandId" value={requested} />
        <Button type="submit" variant="outline" className={actionClass}>{t("scanExpiredFacts")}</Button>
      </form>
      {pages.length === 0 ? <p className={emptyClass}>{t("calendarEmpty")}</p> : calendar.tasks.map((task) => {
        const controlFor = new Map<string, string>();
        for (const page of task.pages) {
          if (!controlFor.has(page.channel)) controlFor.set(page.channel, page.id);
        }
        return (
        <section key={task.id} className="min-w-0 space-y-3">
          <h2 className="break-words text-lg font-semibold">{reasonLabel[task.reason]}</h2>
          <p className="break-words text-sm leading-6 text-muted-foreground">
            {t("chainFact")}: <span className="[overflow-wrap:anywhere]">{task.factVersionId}</span>
          </p>
          <form action={settleMaintenanceAction} className="min-w-0 space-y-3">
            <input type="hidden" name="brandId" value={requested} />
            <input type="hidden" name="taskId" value={task.id} />
            <div
              role="region"
              aria-label={t("calendarTable")}
              tabIndex={0}
              className="max-w-full min-w-0 overflow-x-auto rounded-xl border outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <table className="w-max min-w-full text-left text-sm">
                <thead className="bg-secondary/50 text-muted-foreground">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 font-medium" scope="col">{t("calendarPage")}</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium" scope="col">{t("calendarChannel")}</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium" scope="col">{t("calendarChain")}</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium" scope="col">{t("plannedOn")}</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium" scope="col">{t("verifiedOn")}</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium" scope="col">{t("maintenanceStatus")}</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium" scope="col">{t("publishState")}</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium" scope="col">{t("settleChannels")}</th>
                  </tr>
                </thead>
                <tbody>
                  {task.pages.map((page) => (
                    <tr key={page.id} className="border-t">
                      <td className="w-72 max-w-72 px-4 py-3 align-top whitespace-normal [overflow-wrap:anywhere]">{page.pageUrl}</td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">{page.channel}</td>
                      <td className="w-72 max-w-72 px-4 py-3 align-top whitespace-normal [overflow-wrap:anywhere]">
                        {t("chainDraft")}: {page.draftId}
                        {" · "}
                        {t("chainVariant")}: {page.variantId ?? t("noVariant")}
                        {" · "}
                        {t("chainPage")}: {page.pageId}
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">{page.plannedOn ?? t("calendarNoDate")}</td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">{page.verifiedOn ?? t("notVerifiedYet")}</td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">{statusLabel[page.status]}</td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">{page.published ? t("liveAfterVerification") : t("notLive")}</td>
                      <td className="px-4 py-3 align-top">
                        {controlFor.get(page.channel) === page.id ? (
                          <div className="flex min-w-44 flex-col gap-2">
                            <input type="hidden" name="channel" value={page.channel} />
                            <select
                              name={`state-${page.channel}`}
                              aria-label={t("settleStateFor", { channel: page.channel })}
                              defaultValue=""
                              className="h-10 w-full min-w-0 rounded-md border bg-background px-2"
                            >
                              <option value="">{t("settleUnchanged")}</option>
                              <option value="verified">{t("settleVerified")}</option>
                              <option value="blocked">{t("settleBlocked")}</option>
                            </select>
                            <input
                              type="date"
                              name={`verified-${page.channel}`}
                              aria-label={t("settleDateFor", { channel: page.channel })}
                              className="h-10 w-full min-w-0 rounded-md border bg-background px-2"
                            />
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button type="submit" className={actionClass}>{t("settleChannels")}</Button>
          </form>
        </section>
        );
      })}
    </CalendarCanvas>
  );
}

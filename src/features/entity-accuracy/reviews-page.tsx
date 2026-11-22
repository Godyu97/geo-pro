import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { recordEntityReviewAction } from "./actions";
import { listEntityReviews } from "./commands";
import type { EntityReviewBoard } from "./commands";

const knownErrors = ["INVALID_INPUT", "NOT_FOUND", "SERVICE_UNAVAILABLE"] as const;

function isKnownError(value: string | undefined): value is (typeof knownErrors)[number] {
  return knownErrors.some((code) => code === value);
}

export async function generateMetadata() {
  const t = await getTranslator("entityReviews");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function EntityReviewsPage({
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
  const t = await getTranslator("entityReviews");
  const errorCode = typeof query.error === "string" ? query.error : undefined;
  let listed: { board: EntityReviewBoard } | { error: "NOT_FOUND" | "SERVICE_UNAVAILABLE" };
  try {
    const result = await listEntityReviews(getConnection(), session.user.id, brandId.data);
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

      {board?.label === "sample" && board.errorLabel && board.coverage ? (
        <section className="space-y-2 rounded-2xl border p-5">
          <p className="text-lg font-semibold">{t("sample", { errorLabel: board.errorLabel })}</p>
          <p className="text-sm leading-7">{t("coverage", { coverage: board.coverage })}</p>
          {board.method ? <p className="text-sm text-muted-foreground">{t("method", { method: board.method })}</p> : null}
        </section>
      ) : board ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("insufficient")}</p>
      ) : null}

      <section className="space-y-3 rounded-2xl border p-5">
        <h2 className="text-lg font-semibold">{t("formTitle")}</h2>
        <p className="text-sm leading-7 text-muted-foreground">{t("hint")}</p>
        <form action={recordEntityReviewAction} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="brandId" value={brandId.data} />
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("observationId")}</span>
            <input name="observationId" required className="w-full rounded-md border bg-background px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("analysisVersionId")}</span>
            <input name="analysisVersionId" required className="w-full rounded-md border bg-background px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("population")}</span>
            <input name="population" type="number" min={1} max={100000} step={1} required className="w-full rounded-md border bg-background px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("methodLabel")}</span>
            <input name="method" required maxLength={200} className="w-full rounded-md border bg-background px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t("fact")}</span>
            <select name="fact" defaultValue="active" className="h-10 w-full rounded-md border bg-background px-3">
              <option value="active">{t("factActive")}</option>
              <option value="expired">{t("factExpired")}</option>
              <option value="conflict">{t("factConflict")}</option>
            </select>
          </label>
          <div className="flex flex-wrap items-end gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input name="reviewed" type="checkbox" defaultChecked />
              {t("reviewed")}
            </label>
            <label className="flex items-center gap-2">
              <input name="confirmed" type="checkbox" />
              {t("confirmed")}
            </label>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit">{t("submit")}</Button>
          </div>
        </form>
      </section>
    </div>
  );
}

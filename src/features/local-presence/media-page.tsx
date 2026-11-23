import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { loadOwnedLabels } from "../team-access/commands.ts";
import { listMediaReviews } from "./media-commands.ts";
import { MediaReviewsPanel } from "./media-panel";

export async function generateMetadata() {
  const t = await getTranslator("mediaReviews");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function MediaReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireSession();
  const params = await searchParams;
  const requested = brandIdSchema.safeParse(params.brandId);
  const locale = await getLocale();
  const t = await getTranslator("mediaReviews");
  const messages = getMessages(locale).mediaReviews;
  let workspace = null;
  let labels: { brandId: string; name: string }[] = [];
  try {
    workspace = await listMediaReviews(getConnection(), user.id);
    labels = await loadOwnedLabels(getConnection(), workspace.brands.map((brand) => brand.id));
  } catch {
    console.error("media-reviews-page-unavailable");
  }
  if (!workspace) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p role="alert" className="text-sm leading-6 text-destructive">{t("SERVICE_UNAVAILABLE")}</p>
        <Link href="/dashboard/content" prefetch={false} className="inline-block text-sm underline underline-offset-4">{t("backContent")}</Link>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("description")}</p>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("fixtureNote")}</p>
      </div>
      <MediaReviewsPanel
        brands={workspace.brands}
        facts={workspace.facts}
        reviews={workspace.reviews}
        labels={labels}
        messages={messages}
        initialBrandId={requested.success ? requested.data : null}
      />
      <Link href="/dashboard/content" prefetch={false} className="inline-block text-sm underline underline-offset-4">{t("backContent")}</Link>
    </div>
  );
}

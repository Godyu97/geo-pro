import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { brandMaterialAccess } from "@/features/brands/intake";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { promptUnavailable, readQuestionEntry } from "./service";

const retryHref = "/dashboard/brands/questions";
const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center";
const relatedLinkClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 whitespace-normal [overflow-wrap:anywhere] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function materialNotice(material: { ok: false; error: "closed" | "devActorDenied" }, messages: {
  devActorDenied: string; closed: string;
}) {
  return material.error === "devActorDenied" ? messages.devActorDenied : messages.closed;
}

export async function generateMetadata() {
  const t = await getTranslator("promptSets");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function QuestionEntryPage() {
  const { user } = await requireSession();
  const requestHeaders = await headers();
  const locale = await getLocale();
  const t = await getTranslator("promptSets");
  const messages = getMessages(locale).promptSets;
  const material = brandMaterialAccess(requestHeaders, user.email);

  if (!material.ok) {
    return (
      <div className="min-w-0 space-y-6">
        <header className="min-w-0 space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">{messages.title}</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{messages.description}</p>
          <p role="status" className="max-w-3xl rounded-xl border border-dashed bg-card px-4 py-5 text-sm leading-6 break-words text-muted-foreground [overflow-wrap:anywhere]">
            {materialNotice(material, messages)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild className={actionClass}>
              <Link href="/dashboard/brands" prefetch={false}>{messages.allBrands}</Link>
            </Button>
          </div>
          <nav aria-label={messages.relatedEntries} className="flex min-w-0 flex-wrap gap-2">
            <Link href="/dashboard" prefetch={false} className={relatedLinkClass}>{messages.backOverview}</Link>
          </nav>
        </header>
      </div>
    );
  }

  const result = await readQuestionEntry(getConnection(), user.id).catch(promptUnavailable);
  if ("error" in result) {
    return (
      <div className="min-w-0 space-y-6">
        <header className="min-w-0 space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">{messages.title}</h1>
          <p role="alert" className="max-w-2xl text-sm leading-7 text-destructive">{messages.unavailable}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild className={actionClass}>
              <a href={retryHref}>{messages.reload}</a>
            </Button>
            <Button asChild variant="outline" className={actionClass}>
              <Link href="/dashboard/brands" prefetch={false}>{messages.allBrands}</Link>
            </Button>
          </div>
          <p className="text-xs break-all text-muted-foreground">{t("trace", { id: result.traceId })}</p>
        </header>
      </div>
    );
  }

  if (result.kind === "no-brand") {
    return (
      <div className="min-w-0 space-y-6">
        <header className="min-w-0 space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">{messages.title}</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{messages.description}</p>
          <p className="max-w-3xl rounded-xl border border-dashed bg-card px-4 py-5 text-sm leading-6 break-words text-muted-foreground [overflow-wrap:anywhere]">{messages.entryNoBrand}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild className={actionClass}>
              <Link href="/dashboard/brands" prefetch={false}>{messages.entryOpenBrand}</Link>
            </Button>
          </div>
          <nav aria-label={messages.relatedEntries} className="flex min-w-0 flex-wrap gap-2">
            <Link href="/dashboard" prefetch={false} className={relatedLinkClass}>{messages.backOverview}</Link>
          </nav>
        </header>
      </div>
    );
  }

  redirect(`/dashboard/brands/${result.brandId}/questions`);
}

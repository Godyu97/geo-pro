import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { brandIdSchema } from "@/features/brands/contracts";
import { brandFixtureOrigin } from "@/features/brands/intake";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { workspaceParams } from "./params";
import { promptUnavailable, readPromptWorkspace } from "./service";
import { PromptWorkspaceView } from "./workspace";

export async function promptMetadata() {
  return { title: getMessages(await getLocale()).promptSets.title, robots: { index: false, follow: false } };
}

export async function PromptSetsPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireSession();
  const [locale, requestHeaders, { id }, raw] = await Promise.all([getLocale(), headers(), params, searchParams]);
  const messages = getMessages(locale).promptSets;
  const query = workspaceParams.safeParse(raw);
  if (!brandIdSchema.safeParse(id).success || !query.success) notFound();
  const enabled = brandFixtureOrigin(requestHeaders);
  const href = `/dashboard/brands/${id}`;
  const result = enabled
    ? await Promise.resolve().then(() => readPromptWorkspace(getConnection(), { ownerId: user.id, brandId: id }, query.data)).catch(promptUnavailable)
    : undefined;
  if (result === null) notFound();

  return (
    <section className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-2">
        <Button asChild variant="outline"><Link href={enabled ? href : "/dashboard/brands"} prefetch={false}>{messages.back}</Link></Button>
        <h1 className="text-2xl font-semibold">{messages.title}</h1>
        <p className="text-sm text-muted-foreground">{enabled ? messages.fixture : messages.closed}</p>
      </header>
      {result && ("error" in result ? (
        <div role="alert" className="space-y-2 rounded-xl border p-4">
          <p>{messages.unavailable}</p>
          <p className="text-xs text-muted-foreground">{result.traceId}</p>
          <Button asChild variant="outline"><Link href={href + "/questions"} prefetch={false}>{messages.retry}</Link></Button>
        </div>
      ) : (
        <PromptWorkspaceView key={user.id + id + (query.data.version ?? "")} brandId={id} locale={locale} data={result} messages={messages} />
      ))}
    </section>
  );
}

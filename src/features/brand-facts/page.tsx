import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { brandIdSchema } from "@/features/brands/contracts";
import { brandMaterialAccess } from "@/features/brands/intake";
import { ApplyMockMaterialsButton } from "@/features/functional-mock/material-button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { workspaceParams } from "./params";
import { factUnavailable, readFactWorkspace } from "./service";
import { FactWorkspaceView } from "./workspace";

function materialNotice(material: ReturnType<typeof brandMaterialAccess>, messages: {
  mock: string; dev: string; fixture: string; devActorDenied: string; closed: string;
}) {
  if (!material.ok) return material.error === "devActorDenied" ? messages.devActorDenied : messages.closed;
  if (material.mode === "mock") return messages.mock;
  if (material.mode === "dev") return messages.dev;
  return messages.fixture;
}

export async function factMetadata() {
  return { title: getMessages(await getLocale()).brandFacts.title, robots: { index: false, follow: false } };
}

export async function BrandFactsPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireSession();
  const [locale, requestHeaders, { id }, raw] = await Promise.all([getLocale(), headers(), params, searchParams]);
  const messages = getMessages(locale).brandFacts;
  const query = workspaceParams.safeParse(raw);
  if (!brandIdSchema.safeParse(id).success || !query.success) notFound();
  const material = brandMaterialAccess(requestHeaders, user.email);
  const enabled = material.ok;
  const href = `/dashboard/brands/${id}`;
  const result = enabled
    ? await Promise.resolve().then(() => readFactWorkspace(getConnection(), { ownerId: user.id, brandId: id }, query.data)).catch(factUnavailable)
    : undefined;
  if (result === null) notFound();

  return (
    <section className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-2">
        <Button asChild variant="outline"><Link href={enabled ? href : "/dashboard/brands"} prefetch={false}>{messages.back}</Link></Button>
        <h1 className="text-2xl font-semibold">{messages.title}</h1>
        <p className="text-sm text-muted-foreground">{materialNotice(material, messages)}</p>
        {material.ok && material.mode === "mock" && (
          <ApplyMockMaterialsButton
            brandId={id}
            label={messages.applyMockMaterials}
            pendingLabel={messages.mockMaterialsPending}
            doneLabel={messages.mockMaterialsDone}
            failedLabel={messages.mockMaterialsFailed}
          />
        )}
      </header>
      {result && ("error" in result ? (
        <div role="alert" className="space-y-2 rounded-xl border p-4">
          <p>{messages.unavailable}</p>
          <p className="text-xs text-muted-foreground">{result.traceId}</p>
          <Button asChild variant="outline"><Link href={href + "/facts"} prefetch={false}>{messages.retry}</Link></Button>
        </div>
      ) : (
        <FactWorkspaceView key={user.id + id} brandId={id} locale={locale} data={result} messages={messages} />
      ))}
    </section>
  );
}

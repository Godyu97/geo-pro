import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { BrandDao } from "../brands/dao.ts";
import { listChannelProfiles } from "./commands.ts";
import { channelProfileErrors, type ChannelProfileError } from "./contracts.ts";
import { ProfilePublishForm } from "./profile-publish-form";

const contentPath = "/dashboard/content";
const profilesPath = `${contentPath}/channel-profiles`;
const actionClass = "min-h-10 whitespace-normal text-center";

export async function generateMetadata() {
  const t = await getTranslator("channelProfiles");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function loadProfiles(ownerId: string, requestedBrandId: string | string[] | undefined) {
  const requested = brandIdSchema.safeParse(requestedBrandId);
  if (requestedBrandId !== undefined && !requested.success) return { state: "error", error: "INVALID_INPUT" } as const;

  let brandId = requested.data;
  try {
    const connection = getConnection();
    brandId ??= (await new BrandDao(connection).active(ownerId))?.id;
    if (!brandId) return { state: "noBrand" } as const;
    const listed = await listChannelProfiles(connection, ownerId, brandId);
    if ("error" in listed) return { state: "error", error: listed.error } as const;
    return { state: "ready", ...listed } as const;
  } catch {
    console.error("channel-profile-read-unavailable");
    return { state: "unavailable", brandId } as const;
  }
}

function isErrorCode(value: string): value is ChannelProfileError {
  return Object.hasOwn(channelProfileErrors, value);
}

export default async function ChannelProfilesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const t = await getTranslator("channelProfiles");
  const workspace = await loadProfiles(session.user.id, params.brandId);
  const error = typeof params.error === "string" && isErrorCode(params.error) ? params.error : null;

  if (workspace.state !== "ready") {
    const noBrand = workspace.state === "noBrand";
    const unavailable = workspace.state === "unavailable";
    const retryHref = unavailable && workspace.brandId ? `${profilesPath}?brandId=${workspace.brandId}` : profilesPath;
    return (
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p role={!noBrand || error ? "alert" : undefined} className="max-w-2xl text-sm leading-7 text-muted-foreground">
          {t(unavailable ? "readUnavailable" : noBrand ? error ?? "noBrand" : workspace.error)}
        </p>
        <Button asChild className={actionClass}>
          {unavailable ? <a href={retryHref}>{t("reload")}</a> : (
            <Link href={noBrand ? "/dashboard/brands" : contentPath} prefetch={false}>{t(noBrand ? "goBrands" : "back")}</Link>
          )}
        </Button>
      </header>
    );
  }

  const { brandId, readOnly, versions } = workspace;
  const locale = await getLocale();
  const groups = new Map<string, typeof versions>();
  for (const version of versions) {
    const rows = groups.get(version.channelKey) ?? [];
    rows.push(version);
    groups.set(version.channelKey, rows);
  }

  return (
    <div className="min-w-0 space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        <div className="flex flex-wrap gap-2">
          {!readOnly && (
            <Button asChild className={actionClass}><a href="#profile-channel-key">{t("start")}</a></Button>
          )}
          {versions.length > 0 && (
            <Button asChild variant={readOnly ? "default" : "outline"} className={actionClass}>
              <a href="#profile-versions">{t("browse")}</a>
            </Button>
          )}
          <Button asChild variant={readOnly && versions.length === 0 ? "default" : "outline"} className={actionClass}>
            <Link href={`${contentPath}?brandId=${brandId}`} prefetch={false}>{t("back")}</Link>
          </Button>
        </div>
      </header>

      {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-card p-3 text-sm text-destructive">{t(error)}</p> : null}
      {!error && params.notice === "published" ? (
        <p role="status" className="rounded-lg border bg-card p-3 text-sm">{t("published")}</p>
      ) : null}
      {readOnly ? <p role="status" className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">{t("readOnly")}</p> : (
        <ProfilePublishForm
          key={`${brandId}:${versions.length}:${versions.reduce((latest, version) => (version.createdAt > latest ? version.createdAt : latest), "")}`}
          brandId={brandId}
          labels={{
            channelKey: t("channelKey"), channelKeyHint: t("channelKeyHint"), maxCharacters: t("maxCharacters"),
            maxCharactersHint: t("maxCharactersHint"), note: t("note"), publish: t("publish"), publishing: t("publishing"),
          }}
          feedback={{
            INVALID_INPUT: t("INVALID_INPUT"), NOT_FOUND: t("NOT_FOUND"), SESSION_REQUIRED: t("SESSION_REQUIRED"),
            publishUnconfirmed: t("publishUnconfirmed"),
          }}
        />
      )}

      <section aria-labelledby="profile-versions" className="space-y-4">
        <h2 id="profile-versions" tabIndex={-1} className="scroll-mt-24 rounded-sm text-lg font-semibold focus-visible:outline-2 focus-visible:outline-ring">
          {t("versions")}
        </h2>
        {versions.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          [...groups.entries()].map(([channelKey, rows]) => (
            <section key={channelKey} className="space-y-3">
              <h3 className="font-medium [overflow-wrap:anywhere]">{channelKey}</h3>
              <ul className="space-y-3">
                {rows.map((version) => (
                  <li key={version.id}>
                    <Card size="sm">
                      <CardContent className="space-y-2">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          <Badge variant="outline">{t("versionLabel", { version: version.versionNumber })}</Badge>
                          <span>{version.maxCharacters == null ? t("unlimited") :
                            t("characterLimit", { count: formatNumber(locale, version.maxCharacters) })}</span>
                        </p>
                        <p className="whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{version.note}</p>
                        <p className="text-muted-foreground">{formatDateTime(locale, new Date(version.createdAt))}</p>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </section>
    </div>
  );
}

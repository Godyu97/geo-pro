import { ImageExportBlockers } from "./image-export-blockers";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { formatNumber } from "@/lib/i18n/format";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { Button } from "@/components/ui/button";
import { listChannelProfiles } from "../channel-variants/commands";
import { contentErrors, type ContentError } from "./contracts";
import { readChannelVariants } from "./commands";
import {
  ChannelVariantEditor,
  ChannelVariantPrimary,
  type ChannelVariantNext,
} from "./channel-variant-editor";

export async function generateMetadata() {
  const t = await getTranslator("content");
  return { title: t("channelVariantsTitle"), robots: { index: false, follow: false } };
}

const actionClass = "h-auto max-w-full whitespace-normal";
const relatedClass = "inline-flex min-h-10 min-w-0 max-w-full items-center rounded-lg border bg-card px-3 py-2 text-left text-sm leading-5 break-words whitespace-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function VariantCanvas({
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
    <div className="min-w-0 max-w-full space-y-8">
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

function nextChannelVariant(
  variants: ReadonlyArray<{
    channel: string;
    rejection: "body_diverged" | "master_unapproved" | "variant_unapproved" | "channel_blocked" | null;
  }>,
  readOnly: boolean,
): ChannelVariantNext {
  if (readOnly) return { kind: "readonly", channel: variants[0]?.channel ?? "" };
  const diverged = variants.find((item) => item.rejection === "body_diverged");
  if (diverged) return { kind: "diverged", channel: diverged.channel };
  const master = variants.find((item) => item.rejection === "master_unapproved");
  if (master) return { kind: "master", channel: master.channel };
  const unapproved = variants.find((item) => item.rejection === "variant_unapproved");
  if (unapproved) return { kind: "unapproved", channel: unapproved.channel };
  const exportable = variants.find((item) => item.rejection == null);
  if (exportable) return { kind: "export", channel: exportable.channel };
  const blocked = variants.find((item) => item.rejection === "channel_blocked");
  if (blocked) return { kind: "blocked", channel: blocked.channel };
  return { kind: "empty", channel: "" };
}

function taskCopy(t: Awaited<ReturnType<typeof getTranslator<"content">>>, next: ChannelVariantNext) {
  if (next.kind === "readonly") return t("readOnly");
  if (next.kind === "diverged") return t("channelVariantTaskDiverged");
  if (next.kind === "unapproved") return t("channelVariantTaskUnapproved");
  if (next.kind === "master") return t("channelVariantTaskMaster");
  if (next.kind === "blocked") return t("channelVariantTaskBlocked");
  if (next.kind === "export") return t("channelVariantTaskExport");
  return t("channelVariantTaskEmpty");
}

export default async function ChannelVariantsPage({
  params,
}: {
  params: Promise<{ versionId: string }>;
}) {
  const session = await requireSession();
  const { versionId } = await params;
  const t = await getTranslator("content");
  const locale = await getLocale();
  const href = `/dashboard/content/versions/${versionId}/variants`;
  const versionHref = `/dashboard/content/versions/${versionId}`;
  const back = [{ href: versionHref, label: t("backToVersion") }];
  let detail: Awaited<ReturnType<typeof readChannelVariants>> | { error: "SERVICE_UNAVAILABLE" };
  try {
    detail = await readChannelVariants(getConnection(), session.user.id, versionId);
  } catch {
    console.error("content-channel-variants-read-failed", { versionId });
    detail = { error: "SERVICE_UNAVAILABLE" };
  }
  if ("error" in detail) {
    if (detail.error === "NOT_FOUND") notFound();
    return (
      <VariantCanvas
        title={t("channelVariantsTitle")}
        summary={<p role="alert" className="max-w-2xl break-words text-sm leading-7">{t("channelVariantUnavailable")}</p>}
        primary={(
          <Button asChild className={actionClass}>
            <a href={href}>{t("reload")}</a>
          </Button>
        )}
        relatedLabel={t("relatedEntries")}
        related={back}
      />
    );
  }

  let profiles: Awaited<ReturnType<typeof listChannelProfiles>> | { error: "SERVICE_UNAVAILABLE" };
  try {
    profiles = await listChannelProfiles(getConnection(), session.user.id, detail.version.brandId);
  } catch {
    console.error("content-channel-variants-profiles-failed", { versionId });
    profiles = { error: "SERVICE_UNAVAILABLE" };
  }
  if ("error" in profiles) {
    if (profiles.error === "NOT_FOUND") notFound();
    return (
      <VariantCanvas
        title={t("channelVariantsTitle")}
        summary={<p role="alert" className="max-w-2xl break-words text-sm leading-7">{t("channelVariantUnavailable")}</p>}
        primary={(
          <Button asChild className={actionClass}>
            <a href={href}>{t("reload")}</a>
          </Button>
        )}
        relatedLabel={t("relatedEntries")}
        related={back}
      />
    );
  }

  const limitLabel = (maxCharacters: number | null) => maxCharacters == null
    ? t("channelVariantUnlimited")
    : formatNumber(locale, maxCharacters);
  const errors = Object.fromEntries(
    (Object.keys(contentErrors) as ContentError[]).map((code) => [code, t(code)]),
  );
  const next = nextChannelVariant(detail.variants, detail.readOnly);
  const primaryIsBack = next.kind === "master" || next.kind === "blocked" || next.kind === "readonly";
  const related = [
    ...back,
    { href: `/dashboard/content/channel-profiles?brandId=${detail.version.brandId}`, label: t("channelProfilesLink") },
    { href: `/dashboard/brands/${detail.version.brandId}/facts`, label: t("brandFactsLink") },
  ].filter((item) => !primaryIsBack || item.href !== versionHref);

  return (
    <VariantCanvas
      title={t("channelVariantsTitle")}
      summary={<p role="status" className="max-w-2xl break-words text-sm leading-7 text-muted-foreground">{taskCopy(t, next)}</p>}
      primary={(
        <ChannelVariantPrimary
          next={next}
          brandId={detail.version.brandId}
          versionId={detail.version.id}
          versionHref={versionHref}
          className={actionClass}
          copy={{
            save: t("saveChannelVariant"),
            approve: t("approveChannelVariant"),
            export: t("exportChannelVariant"),
            back: t("backToVersion"),
            errors,
          }}
        />
      )}
      relatedLabel={t("relatedEntries")}
      related={related}
    >
      {detail.invalidImageAssets.length ? (
        <section className="min-w-0 rounded-2xl border bg-card p-5" aria-label={t("invalidImages")}>
          <p role="status" className="text-sm">{t("IMAGE_RIGHTS_INVALID")}</p>
          <ImageExportBlockers images={detail.invalidImageAssets} editHref={`${versionHref}#version-images`} t={t} />
        </section>
      ) : null}
      <section className="min-w-0 space-y-2">
        <h2 className="text-lg font-semibold">{t("titleField")}</h2>
        <p className="[overflow-wrap:anywhere] text-sm leading-6">{detail.version.title}</p>
      </section>
      {detail.readOnly ? <p role="status" className="text-sm text-muted-foreground">{t("readOnly")}</p> : null}
      <ChannelVariantEditor
        versionId={detail.version.id}
        brandId={detail.version.brandId}
        next={next}
        variants={detail.variants.map((item) => ({
          id: item.id,
          channel: item.channel,
          bodyMarkdown: item.bodyMarkdown,
          approvalStatus: item.approvalStatus,
          needsOwnApproval: item.needsOwnApproval,
          blocked: item.blocked,
          rejection: item.rejection,
          channelProfileVersionId: item.channelProfileVersionId,
          pinLabel: item.profileVersionNumber == null
            ? t("channelVariantUnpinned")
            : t("channelVariantPinned", {
              version: item.profileVersionNumber,
              limit: limitLabel(item.profileMaxCharacters),
            }),
        }))}
        profiles={profiles.versions.map((item) => ({
          id: item.id,
          channelKey: item.channelKey,
          label: t("channelVariantPinOption", {
            channel: item.channelKey,
            version: item.versionNumber,
            limit: limitLabel(item.maxCharacters),
          }),
        }))}
        readOnly={detail.readOnly}
        copy={{
          channel: t("channel"),
          body: t("bodyMarkdown"),
          status: t("versionStatus"),
          draft: t("channelVariantDraft"),
          approved: t("channelVariantApproved"),
          blocked: t("channelVariantBlockedFlag"),
          reason: t("channelVariantReason"),
          none: t("channelVariantReason_none"),
          master_unapproved: t("channelVariantReason_master_unapproved"),
          body_diverged: t("channelVariantReason_body_diverged"),
          variant_unapproved: t("channelVariantReason_variant_unapproved"),
          channel_blocked: t("channelVariantReason_channel_blocked"),
          save: t("saveChannelVariant"),
          approve: t("approveChannelVariant"),
          block: t("blockChannelVariant"),
          export: t("exportChannelVariant"),
          saved: t("channelVariantSaved"),
          exported: t("channelVariantExportDone"),
          empty: t("channelVariantEmpty"),
          unsaved: t("channelVariantUnsaved"),
          hint: t("channelVariantsHint"),
          pin: t("channelVariantPin"),
          pinRequired: t("channelVariantPinRequired"),
          errors,
        }}
      />
    </VariantCanvas>
  );
}

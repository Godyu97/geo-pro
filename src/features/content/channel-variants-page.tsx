import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { formatNumber } from "@/lib/i18n/format";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { listChannelProfiles } from "../channel-variants/commands";
import { contentErrors, type ContentError } from "./contracts";
import { readChannelVariants } from "./commands";
import { ChannelVariantEditor } from "./channel-variant-editor";

export async function generateMetadata() {
  const t = await getTranslator("content");
  return { title: t("channelVariantsTitle"), robots: { index: false, follow: false } };
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
  const connection = getConnection();
  const detail = await readChannelVariants(connection, session.user.id, versionId);
  if ("error" in detail) notFound();
  const profiles = await listChannelProfiles(connection, session.user.id, detail.version.brandId);
  if ("error" in profiles) notFound();
  const limitLabel = (maxCharacters: number | null) => maxCharacters == null
    ? t("channelVariantUnlimited")
    : formatNumber(locale, maxCharacters);

  const errors = Object.fromEntries(
    (Object.keys(contentErrors) as ContentError[]).map((code) => [code, t(code)]),
  );

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href={`/dashboard/content/versions/${detail.version.id}`} prefetch={false} className="underline-offset-4 hover:underline">
            {t("backToVersion")}
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("channelVariantsTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{detail.version.title}</p>
        <p className="mt-2 text-sm">
          <Link href={`/dashboard/content/channel-profiles?brandId=${detail.version.brandId}`} prefetch={false} className="underline-offset-4 hover:underline">
            {t("channelProfilesLink")}
          </Link>
        </p>
      </div>
      {detail.readOnly ? <p role="status" className="text-sm text-muted-foreground">{t("readOnly")}</p> : null}
      <ChannelVariantEditor
        versionId={detail.version.id}
        brandId={detail.version.brandId}
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
    </div>
  );
}

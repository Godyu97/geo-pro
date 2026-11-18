"use client";

import Link from "next/link";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { brandErrorMessage } from "./error-messages";
import { useBrandMutation } from "./use-brand-mutation";

export function BrandDeletionButtons({ action, id, revision, actorId, messages }: {
  action: "freeze" | "recover"; id: string; revision: number; actorId: string; messages: Messages["brands"];
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const { send, pending, error } = useBrandMutation(actorId);
  const brandHref = "/dashboard/brands/" + id;
  const recoveryHref = brandHref + "/recovery";

  async function submit() {
    const target = { brandId: id, expectedBrandRevision: revision };
    const result = await send(action === "freeze" ? { ...target, action, confirmed: true } : { ...target, action });
    if (result?.kind === "deletion") window.location.replace(action === "freeze" ? recoveryHref : brandHref);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant={action === "freeze" ? "destructive" : "default"} disabled={pending} onClick={() => void submit()}>
          {t(pending ? "saving" : action === "freeze" ? "confirmDeletion" : "recoverDeletedBrand")}
        </Button>
        {action === "freeze" && (
          <Button asChild variant="outline"><Link href={brandHref} prefetch={false}>{t("cancelDeletion")}</Link></Button>
        )}
      </div>
      {error && (
        <div role="alert" className="space-y-2 text-sm">
          <p className="font-medium text-destructive">{t(brandErrorMessage[error.code])}</p>
          {error.code === "LIMIT_REACHED" && <Link href="/dashboard/brands" className="underline">{t("archiveFirst")}</Link>}
          {error.code === "REAUTH_REQUIRED" && <SignOutButton returnTo={recoveryHref} label={t("reauthenticate")} />}
          {(error.code === "VERSION_CONFLICT" || error.code === "OPERATION_CONFLICT" || error.code === "NOT_FOUND") && (
            <Button variant="outline" onClick={() => window.location.reload()}>{t("reload")}</Button>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import type { BrandRecord } from "./dao";
import { brandErrorMessage } from "./error-messages";
import { useBrandMutation } from "./use-brand-mutation";

export function BrandStatusButton({ brand, actorId, messages }: {
  brand: Pick<BrandRecord, "id" | "revision" | "status">;
  actorId: string;
  messages: Messages["brands"];
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const { pending, error, send } = useBrandMutation(actorId);
  const action = brand.status === "active" ? "archive" : "restore";

  async function changeStatus() {
    const result = await send({ action, brandId: brand.id, expectedBrandRevision: brand.revision });
    if (result?.kind === "brand") window.location.reload();
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" disabled={pending} onClick={() => void changeStatus()}>
        {t(pending ? "saving" : action)}
      </Button>
      <p className="text-sm leading-6 text-muted-foreground">{t(action === "archive" ? "archiveDescription" : "restoreDescription")}</p>
      {error && (
        <div role="alert" className="space-y-2 text-sm">
          <p className="font-medium text-destructive">{t(brandErrorMessage[error.code])}</p>
          {error.code === "LIMIT_REACHED" && <Link href="/dashboard/brands" className="underline">{t("archiveFirst")}</Link>}
          {error.code === "VERSION_CONFLICT" && <Button variant="outline" onClick={() => window.location.reload()}>{t("reload")}</Button>}
        </div>
      )}
    </div>
  );
}

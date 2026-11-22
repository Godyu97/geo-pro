import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao.ts";
import {
  expireImageAssetAction,
  registerImageAssetAction,
  registerImageAssetUseAction,
  revokeImageAssetAction,
} from "./image-asset-actions.ts";
import { listImageAssets } from "./image-asset-commands.ts";
import type { ImageAssetDetail, ImageRights } from "./image-asset-contracts.ts";

const inputClass = "block w-full rounded-md border bg-background px-3 py-2 text-sm";

const errorCodes = ["NOT_FOUND", "INVALID_INPUT", "RIGHTS_CLOSED", "FORBIDDEN", "SESSION_REQUIRED", "SERVICE_UNAVAILABLE"] as const;
const noticeCodes = ["registered", "useAdded", "revoked", "expired"] as const;

function isErrorCode(value: string): value is (typeof errorCodes)[number] {
  return errorCodes.some((code) => code === value);
}

function isNoticeCode(value: string): value is (typeof noticeCodes)[number] {
  return noticeCodes.some((code) => code === value);
}

function rightsKey(status: ImageRights) {
  if (status === "active") return "rightsActive" as const;
  if (status === "revoked") return "rightsRevoked" as const;
  return "rightsExpired" as const;
}

export async function generateMetadata() {
  const t = await getTranslator("imageAssets");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function ImageAssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const t = await getTranslator("imageAssets");
  const connection = getConnection();
  const active = await new BrandDao(connection).active(session.user.id);
  const brandId = typeof params.brandId === "string" ? params.brandId : active?.id;
  const error = typeof params.error === "string" && isErrorCode(params.error) ? params.error : null;
  const notice = typeof params.notice === "string" && isNoticeCode(params.notice) ? params.notice : null;

  if (!brandId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("noBrand")}</p>
        <Button asChild><Link href="/dashboard/brands" prefetch={false}>{t("goBrands")}</Link></Button>
      </div>
    );
  }

  const listed = await listImageAssets(connection, session.user.id, brandId);
  if ("error" in listed) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{t(listed.error)}</p>
        <Link href="/dashboard/content" prefetch={false} className="underline underline-offset-4">{t("back")}</Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm">
          <Link href={`/dashboard/content?brandId=${brandId}`} prefetch={false} className="underline underline-offset-4">{t("back")}</Link>
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
      </div>

      {error ? <p role="alert" className="text-sm">{t(error)}</p> : null}
      {notice ? <p role="status" className="text-sm">{t(notice)}</p> : null}

      <form action={registerImageAssetAction} className="max-w-xl space-y-3 rounded-2xl border px-4 py-4 text-sm">
        <input type="hidden" name="brandId" value={brandId} />
        <label className="block">
          <span className="mb-1 block text-muted-foreground">{t("fileName")}</span>
          <input className={inputClass} name="fileName" required maxLength={120} />
        </label>
        <label className="block">
          <span className="mb-1 block text-muted-foreground">{t("version")}</span>
          <input className={inputClass} name="version" inputMode="numeric" defaultValue="1" />
        </label>
        <label className="block">
          <span className="mb-1 block text-muted-foreground">{t("byteSize")}</span>
          <input className={inputClass} name="byteSize" inputMode="numeric" />
        </label>
        <Button type="submit">{t("register")}</Button>
      </form>

      {listed.assets.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-4">
          {listed.assets.map((item) => (
            <AssetCard key={item.asset.id} item={item} brandId={brandId} />
          ))}
        </ul>
      )}
    </div>
  );
}

async function AssetCard({ item, brandId }: { item: ImageAssetDetail; brandId: string }) {
  const t = await getTranslator("imageAssets");
  const closed = item.asset.rightsStatus !== "active";
  return (
    <li className="rounded-2xl border px-4 py-4 text-sm">
      <p className="font-medium break-all">{item.asset.fileName}</p>
      <p className="mt-2 leading-6 text-muted-foreground">
        {t("versionLine", { version: String(item.asset.version) })}
        {" · "}
        {item.asset.byteSize === null ? t("bytesEmpty") : t("bytesLine", { size: String(item.asset.byteSize) })}
      </p>
      <p className="mt-2 leading-6">{t(rightsKey(item.asset.rightsStatus))}</p>

      <h2 className="mt-4 font-medium">{t("uses")}</h2>
      {item.uses.length === 0 ? (
        <p className="mt-2 text-muted-foreground">{t("noUses")}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {item.uses.map((use) => (
            <li key={use.id} className="break-all font-mono text-xs leading-5">
              {t("useLine", { version: String(use.assetVersion), content: use.contentVersionId })}
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-4 font-medium">{t("todos")}</h2>
      {item.todos.length === 0 ? (
        <p className="mt-2 text-muted-foreground">{t("noTodos")}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {item.todos.map((todo) => (
            <li key={todo.id} className="break-all font-mono text-xs leading-5">
              {t("todoLine", { version: String(todo.assetVersion), content: todo.contentVersionId })}
            </li>
          ))}
        </ul>
      )}

      {closed ? null : (
        <form action={registerImageAssetUseAction} className="mt-4 space-y-3">
          <input type="hidden" name="brandId" value={brandId} />
          <input type="hidden" name="id" value={item.asset.id} />
          <label className="block">
            <span className="mb-1 block text-muted-foreground">{t("contentVersion")}</span>
            <input className={inputClass} name="contentVersionId" required maxLength={36} />
          </label>
          <Button type="submit">{t("addUse")}</Button>
        </form>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {item.asset.rightsStatus === "revoked" ? null : (
          <form action={revokeImageAssetAction}>
            <input type="hidden" name="brandId" value={brandId} />
            <input type="hidden" name="id" value={item.asset.id} />
            <Button type="submit" variant="outline">{t("revoke")}</Button>
          </form>
        )}
        {item.asset.rightsStatus === "active" ? (
          <form action={expireImageAssetAction}>
            <input type="hidden" name="brandId" value={brandId} />
            <input type="hidden" name="id" value={item.asset.id} />
            <Button type="submit" variant="outline">{t("expire")}</Button>
          </form>
        ) : null}
      </div>
    </li>
  );
}

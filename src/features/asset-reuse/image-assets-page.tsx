import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { BrandDao } from "../brands/dao.ts";
import {
  expireImageAssetAction,
  registerImageAssetAction,
  registerImageAssetUseAction,
  revokeImageAssetAction,
} from "./image-asset-actions.ts";
import { listImageAssets } from "./image-asset-commands.ts";
import type { ImageAssetDetail, ImageRights } from "./image-asset-contracts.ts";
import { ImageRightsConfirmation } from "./image-rights-confirmation.tsx";

const assetsPath = "/dashboard/content/assets";
const contentPath = "/dashboard/content";
const actionClass = "min-h-10 whitespace-normal text-center";
type Translator = Awaited<ReturnType<typeof getTranslator<"imageAssets">>>;

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

async function loadAssets(ownerId: string, requestedBrandId: string | string[] | undefined) {
  const requested = brandIdSchema.safeParse(requestedBrandId);
  if (requestedBrandId !== undefined && !requested.success) {
    return { state: "notFound" } as const;
  }
  let brandId = requested.data;
  try {
    const connection = getConnection();
    brandId ??= (await new BrandDao(connection).active(ownerId))?.id;
    if (!brandId) return { state: "noBrand" } as const;
    const listed = await listImageAssets(connection, ownerId, brandId);
    if ("error" in listed) return { state: "notFound" } as const;
    return { state: "ready", brandId, assets: listed.assets } as const;
  } catch {
    console.error("image-asset-list-unavailable");
    return { state: "unavailable", brandId } as const;
  }
}

export default async function ImageAssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const t = await getTranslator("imageAssets");
  const workspace = await loadAssets(session.user.id, params.brandId);
  const error = typeof params.error === "string" && isErrorCode(params.error) ? params.error : null;
  const notice = typeof params.notice === "string" && isNoticeCode(params.notice) ? params.notice : null;

  if (workspace.state !== "ready") {
    const noBrand = workspace.state === "noBrand";
    const unavailable = workspace.state === "unavailable";
    const href = unavailable
      ? (workspace.brandId ? `${assetsPath}?brandId=${workspace.brandId}` : assetsPath)
      : noBrand ? "/dashboard/brands" : contentPath;
    const action = unavailable ? t("reload") : noBrand ? t("goBrands") : t("back");
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p role={noBrand ? undefined : "alert"} className="max-w-2xl text-sm leading-7 text-muted-foreground">
          {t(noBrand ? "noBrand" : unavailable ? "SERVICE_UNAVAILABLE" : "NOT_FOUND")}
        </p>
        <Button asChild className={actionClass}>
          {unavailable ? <a href={href}>{action}</a> : <Link href={href} prefetch={false}>{action}</Link>}
        </Button>
      </div>
    );
  }

  const { brandId, assets } = workspace;
  return (
    <div className="min-w-0 space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild className={actionClass}><a href="#image-asset-file-name">{t("startRegistration")}</a></Button>
          {assets.length > 0 && (
            <Button asChild variant="outline" className={actionClass}><a href="#image-assets-list">{t("viewAssets")}</a></Button>
          )}
          <Button asChild variant="outline" className={actionClass}>
            <Link href={`${contentPath}?brandId=${brandId}`} prefetch={false}>{t("back")}</Link>
          </Button>
        </div>
      </header>

      {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-card p-3 text-sm text-destructive">{t(error)}</p> : null}
      {notice ? <p role="status" className="rounded-lg border bg-card p-3 text-sm">{t(notice)}</p> : null}

      <Card className="max-w-xl">
        <CardContent>
          <h2 id="register-image-asset" className="mb-3 font-semibold">{t("register")}</h2>
          <form aria-labelledby="register-image-asset" action={registerImageAssetAction} className="space-y-3 text-sm">
            <input type="hidden" name="brandId" value={brandId} />
            <label className="block">
              <span className="mb-1 block">{t("fileName")}</span>
              <Input id="image-asset-file-name" className="min-h-10 scroll-mt-24" name="fileName" required maxLength={120} />
            </label>
            <label className="block">
              <span className="mb-1 block">{t("version")}</span>
              <Input className="min-h-10" name="version" inputMode="numeric" defaultValue="1" />
            </label>
            <label className="block">
              <span className="mb-1 block">{t("byteSize")}</span>
              <Input className="min-h-10" name="byteSize" inputMode="numeric" />
            </label>
            <Button type="submit" className={actionClass}>{t("register")}</Button>
          </form>
        </CardContent>
      </Card>

      <section aria-labelledby="image-assets-list" className="space-y-3">
        <h2 id="image-assets-list" tabIndex={-1} className="scroll-mt-24 rounded-sm font-semibold focus-visible:outline-2 focus-visible:outline-ring">
          {t("assetList")}
        </h2>
        {assets.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="space-y-4">
            {assets.map((item) => (
              <AssetCard key={item.asset.id} item={item} brandId={brandId} t={t} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AssetCard({ item, brandId, t }: { item: ImageAssetDetail; brandId: string; t: Translator }) {
  const closed = item.asset.rightsStatus !== "active";
  return (
    <li className="min-w-0 rounded-xl border bg-card p-4 text-sm text-card-foreground">
      <h3 className="font-semibold [overflow-wrap:anywhere]">{item.asset.fileName}</h3>
      <p className="mt-2 leading-6 text-muted-foreground">
        {t("versionLine", { version: String(item.asset.version) })}
        {" · "}
        {item.asset.byteSize === null ? t("bytesEmpty") : t("bytesLine", { size: String(item.asset.byteSize) })}
      </p>
      <p className="mt-2 leading-6">{t(rightsKey(item.asset.rightsStatus))}</p>

      <h4 className="mt-4 font-medium">{t("uses")}</h4>
      {item.uses.length === 0 ? (
        <p className="mt-2 text-muted-foreground">{t("noUses")}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {item.uses.map((use) => (
            <li key={use.id} className="break-all font-mono text-xs leading-5">
              {t("useLine", { version: String(use.assetVersion), content: use.contentVersionId })}
              {use.supersededAt ? <span> · {t("historicalUse")}</span> : null}
            </li>
          ))}
        </ul>
      )}

      <h4 className="mt-4 font-medium">{t("todos")}</h4>
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
            <Input className="min-h-10" name="contentVersionId" required maxLength={36} />
          </label>
          <Button type="submit" className={actionClass}>{t("addUse")}</Button>
        </form>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {item.asset.rightsStatus === "revoked" ? null : (
          <ImageRightsConfirmation action={revokeImageAssetAction} brandId={brandId} id={item.asset.id}
            fileName={item.asset.fileName} title={t("revoke")} description={t("revokeDescription")}
            confirm={t("confirmRevoke")} cancel={t("cancel")} pending={t("saving")} />
        )}
        {item.asset.rightsStatus === "active" ? (
          <ImageRightsConfirmation action={expireImageAssetAction} brandId={brandId} id={item.asset.id}
            fileName={item.asset.fileName} title={t("expire")} description={t("expireDescription")}
            confirm={t("confirmExpire")} cancel={t("cancel")} pending={t("saving")} />
        ) : null}
      </div>
    </li>
  );
}

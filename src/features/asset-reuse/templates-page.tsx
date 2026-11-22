import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { BrandDao } from "../brands/dao.ts";
import { cloneContentTemplateAction, exportContentTemplateAction } from "./template-actions.ts";
import { listContentTemplates } from "./template-commands.ts";
import type { TemplateStatus, TemplateView } from "./template-contracts.ts";

const inputClass = "block w-full rounded-md border bg-background px-3 py-2 text-sm";

const errorCodes = ["NOT_FOUND", "INVALID_INPUT", "GATE_REQUIRED", "SYSTEM_READONLY", "FORBIDDEN", "SESSION_REQUIRED", "SERVICE_UNAVAILABLE"] as const;
const noticeCodes = ["cloned", "fact_gate", "approval_gate"] as const;

function isErrorCode(value: string): value is (typeof errorCodes)[number] {
  return errorCodes.some((code) => code === value);
}

function isNoticeCode(value: string): value is (typeof noticeCodes)[number] {
  return noticeCodes.some((code) => code === value);
}

function statusKey(status: TemplateStatus) {
  if (status === "draft") return "statusDraft" as const;
  if (status === "published") return "statusPublished" as const;
  return "statusRetired" as const;
}

function gateText(on: boolean, onLabel: string, offLabel: string) {
  return on ? onLabel : offLabel;
}

export async function generateMetadata() {
  const t = await getTranslator("contentTemplates");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function ContentTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const t = await getTranslator("contentTemplates");
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

  const listed = await listContentTemplates(connection, session.user.id, brandId);
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

      {listed.templates.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-4">
          {listed.templates.map((template) => (
            <TemplateCard key={template.id} template={template} brandId={brandId} />
          ))}
        </ul>
      )}
    </div>
  );
}

async function TemplateCard({ template, brandId }: { template: TemplateView; brandId: string }) {
  const t = await getTranslator("contentTemplates");
  const on = t("gateOn");
  const off = t("gateOff");
  return (
    <li className="rounded-2xl border px-4 py-4 text-sm">
      <p className="font-medium break-all">{template.name}</p>
      <p className="mt-2 leading-6 text-muted-foreground">
        {template.system ? t("system") : t("team")}
        {template.readOnly ? ` · ${t("readOnly")}` : ""}
        {` · ${t(statusKey(template.status))}`}
      </p>
      <p className="mt-2 leading-6">
        {t("factGate")} {gateText(template.gates.fact, on, off)}
        {" · "}
        {t("licenseGate")} {gateText(template.gates.publicLicense, on, off)}
        {" · "}
        {t("reviewGate")} {gateText(template.gates.review, on, off)}
      </p>
      {template.asksToInventCaseStudy ? <p className="mt-2 leading-6">{t("inventsCase")}</p> : null}
      <form action={cloneContentTemplateAction} className="mt-4 space-y-3">
        <input type="hidden" name="brandId" value={brandId} />
        <input type="hidden" name="id" value={template.id} />
        <label className="block">
          <span className="mb-1 block text-muted-foreground">{t("cloneName")}</span>
          <input className={inputClass} name="name" maxLength={120} />
        </label>
        <div className="flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="fact" value="1" defaultChecked />
            {t("factGate")}
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="publicLicense" value="1" defaultChecked />
            {t("licenseGate")}
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="review" value="1" defaultChecked />
            {t("reviewGate")}
          </label>
        </div>
        <Button type="submit">{t("clone")}</Button>
      </form>
      <form action={exportContentTemplateAction} className="mt-3">
        <input type="hidden" name="brandId" value={brandId} />
        <input type="hidden" name="id" value={template.id} />
        <Button type="submit" variant="outline">{t("exportCheck")}</Button>
      </form>
    </li>
  );
}

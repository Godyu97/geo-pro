import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { getTranslator } from "@/lib/i18n/server";
import { brandIdSchema } from "../brands/contracts.ts";
import { BrandDao } from "../brands/dao.ts";
import { exportContentTemplateAction } from "./template-actions.ts";
import { TemplateCloneForm } from "./template-clone-form";
import { listContentTemplates } from "./template-commands.ts";
import { templateErrors, type TemplateError, type TemplateStatus, type TemplateView } from "./template-contracts.ts";

const templatesPath = "/dashboard/content/templates";
const contentPath = "/dashboard/content";
const actionClass = "min-h-10 whitespace-normal text-center";
type Translator = Awaited<ReturnType<typeof getTranslator<"contentTemplates">>>;

const noticeCodes = ["cloned", "fact_gate", "approval_gate"] as const;

function isErrorCode(value: string): value is TemplateError {
  return Object.hasOwn(templateErrors, value);
}

function isNoticeCode(value: string): value is (typeof noticeCodes)[number] {
  return noticeCodes.some((code) => code === value);
}

function statusKey(status: TemplateStatus) {
  if (status === "draft") return "statusDraft" as const;
  if (status === "published") return "statusPublished" as const;
  return "statusRetired" as const;
}

export async function generateMetadata() {
  const t = await getTranslator("contentTemplates");
  return { title: t("title"), robots: { index: false, follow: false } };
}

async function loadTemplates(ownerId: string, requestedBrandId: string | string[] | undefined) {
  const requested = brandIdSchema.safeParse(requestedBrandId);
  if (requestedBrandId !== undefined && !requested.success) return { state: "notFound" } as const;

  let brandId = requested.data;
  try {
    const connection = getConnection();
    brandId ??= (await new BrandDao(connection).active(ownerId))?.id;
    if (!brandId) return { state: "noBrand" } as const;
    const listed = await listContentTemplates(connection, ownerId, brandId);
    if ("error" in listed) return { state: "notFound" } as const;
    return { state: "ready", brandId, templates: listed.templates } as const;
  } catch {
    console.error("content-template-page-unavailable");
    return { state: "unavailable", brandId } as const;
  }
}

export default async function ContentTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const t = await getTranslator("contentTemplates");
  const workspace = await loadTemplates(session.user.id, params.brandId);
  const error = typeof params.error === "string" && isErrorCode(params.error) ? params.error : null;
  const notice = typeof params.notice === "string" && isNoticeCode(params.notice) ? params.notice : null;

  if (workspace.state !== "ready") {
    const noBrand = workspace.state === "noBrand";
    const unavailable = workspace.state === "unavailable";
    const retryHref = unavailable && workspace.brandId ? `${templatesPath}?brandId=${workspace.brandId}` : templatesPath;
    return (
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p role={!noBrand || error ? "alert" : undefined} className="max-w-2xl text-sm leading-7 text-muted-foreground">
          {t(unavailable ? "SERVICE_UNAVAILABLE" : noBrand ? error ?? "noBrand" : "brandUnavailable")}
        </p>
        <Button asChild className={actionClass}>
          {unavailable ? <a href={retryHref}>{t("reload")}</a> : (
            <Link href={noBrand ? "/dashboard/brands" : contentPath} prefetch={false}>{t(noBrand ? "goBrands" : "back")}</Link>
          )}
        </Button>
      </header>
    );
  }

  const { brandId, templates } = workspace;
  const feedback = error ?? notice;
  const success = feedback === "cloned";
  return (
    <div className="min-w-0 space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{t("description")}</p>
        <div className="flex flex-wrap gap-2">
          {templates.length > 0 && (
            <Button asChild className={actionClass}><a href="#content-template-list">{t("browse")}</a></Button>
          )}
          <Button asChild variant={templates.length > 0 ? "outline" : "default"} className={actionClass}>
            <Link href={`${contentPath}?brandId=${brandId}`} prefetch={false}>{t("back")}</Link>
          </Button>
        </div>
      </header>

      {feedback && (
        <p id="template-feedback" tabIndex={-1} role={success ? "status" : "alert"}
          className={`scroll-mt-24 rounded-lg border bg-card p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring ${success ? "" : "border-destructive/30 text-destructive"}`}>
          {t(feedback)}
        </p>
      )}

      <section aria-labelledby="content-template-list" className="space-y-3">
        <h2 id="content-template-list" tabIndex={-1}
          className="scroll-mt-24 rounded-sm font-semibold focus-visible:outline-2 focus-visible:outline-ring">
          {t("list")}
        </h2>
        {templates.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="space-y-4">
            {templates.map((template) => (
              <TemplateCard key={`${brandId}:${template.id}`} template={template} brandId={brandId} t={t} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TemplateCard({ template, brandId, t }: { template: TemplateView; brandId: string; t: Translator }) {
  const gateState = (on: boolean) => t(on ? "gateOn" : "gateOff");
  return (
    <li>
      <Card size="sm">
        <CardContent className="space-y-4 text-sm">
          <div className="space-y-2">
            <h3 className="font-semibold [overflow-wrap:anywhere]">{template.name}</h3>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{t(template.system ? "system" : "team")}</Badge>
              {template.readOnly && <Badge variant="outline">{t("readOnly")}</Badge>}
              <Badge variant="outline">{t(statusKey(template.status))}</Badge>
            </div>
          </div>
          <dl className="flex flex-wrap gap-x-5 gap-y-2">
            <div><dt className="text-muted-foreground">{t("factGate")}</dt><dd>{gateState(template.gates.fact)}</dd></div>
            <div><dt className="text-muted-foreground">{t("licenseGate")}</dt><dd>{gateState(template.gates.publicLicense)}</dd></div>
            <div><dt className="text-muted-foreground">{t("reviewGate")}</dt><dd>{gateState(template.gates.review)}</dd></div>
          </dl>
          {template.asksToInventCaseStudy && (
            <p className="rounded-lg border border-destructive/30 bg-card p-3 text-destructive">{t("inventsCase")}</p>
          )}
          <TemplateCloneForm
            brandId={brandId}
            templateId={template.id}
            labels={{
              name: t("cloneName"), clone: t("clone"), cloning: t("cloning"),
              fact: t("factGate"), publicLicense: t("licenseGate"), review: t("reviewGate"),
            }}
            feedback={{
              cloned: t("cloned"), INVALID_INPUT: t("INVALID_INPUT"), NOT_FOUND: t("NOT_FOUND"),
              GATE_REQUIRED: t("GATE_REQUIRED"), cloneUnconfirmed: t("cloneUnconfirmed"),
            }}
          />
          <form action={exportContentTemplateAction}>
            <input type="hidden" name="brandId" value={brandId} />
            <input type="hidden" name="id" value={template.id} />
            <Button type="submit" variant="outline" className={actionClass}>{t("exportCheck")}</Button>
          </form>
        </CardContent>
      </Card>
    </li>
  );
}

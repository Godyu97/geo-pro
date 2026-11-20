import { createHash } from "node:crypto";
import type { GapType } from "./contracts.ts";

export type DiagnosisInput = {
  observationId: string;
  analysisVersionId?: string | null;
  questionText: string;
  answerText: string;
  mentioned: "true" | "false" | "unknown";
  recommended: "true" | "false" | "unknown";
  officialSiteCited: "true" | "false" | "unknown";
  citationSetState: string;
  citations: Array<{ normalizedUrl: string; pageStatus: string; ownership: string }>;
  brandName: string;
  businessImportance?: number;
};

export type FindingDraft = {
  gapType: GapType;
  questionCluster: string;
  targetPage: string;
  observationId: string | null;
  analysisVersionId: string | null;
  evidenceSummary: string;
  problemStatement: string;
  hypothesis: string;
  assumptionLevel: "observed_absence" | "verified" | "pending";
  steps: string[];
  completionCriteria: string;
  retestMethod: string;
  businessImportance: number;
  estimatedEffort: number;
  verifiedEvidence: 0 | 1;
  privacyRisk: 0 | 1;
  title: string;
};

export type PriorityFields = {
  priorityBucket: "urgent" | "normal";
  businessImportance: number;
  verifiedEvidence: 0 | 1;
  estimatedEffort: number;
  createdAt: string;
  manualRank: number | null;
};

const EXECUTABLE_INSTRUCTION =
  /(立即发布|马上发布|修改权限|grant\s+access|change\s+permission|publish\s+now|执行以下命令|run\s+this\s+command)/i;

export function normalizeQuestionCluster(questionText: string) {
  const normalized = questionText.trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 32);
}

export function normalizeTargetPage(url: string | null | undefined) {
  if (!url) return "n/a";
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}`;
  } catch {
    return url.trim().toLowerCase() || "n/a";
  }
}

export function dedupeKey(parts: {
  brandId: string;
  questionCluster: string;
  targetPage: string;
  gapType: GapType;
}) {
  return [parts.brandId, parts.questionCluster, parts.targetPage, parts.gapType].join("|");
}

export function diagnoseFromEvidence(input: DiagnosisInput): FindingDraft[] {
  const importance = Math.min(3, Math.max(1, input.businessImportance ?? 2));
  const cluster = normalizeQuestionCluster(input.questionText);
  const owned = input.citations.find((item) => item.ownership === "owned_domain");
  const targetPage = normalizeTargetPage(owned?.normalizedUrl);
  const drafts: FindingDraft[] = [];

  if (input.mentioned === "false") {
    drafts.push({
      gapType: "key_content_missing",
      questionCluster: cluster,
      targetPage,
      observationId: input.observationId,
      analysisVersionId: input.analysisVersionId ?? null,
      evidenceSummary: `回答未提及品牌「${input.brandName}」。原文摘录长度 ${input.answerText.trim().length}。`,
      problemStatement: "在已合格回答样本中观察到品牌缺席。",
      hypothesis: "缺席原因尚待验证，可能包括覆盖不足、问题簇不匹配或样本波动；此处仅记录观察，不作淘汰或软文因果判断。",
      assumptionLevel: "observed_absence",
      steps: [
        "复核同口径其他样本是否同样未提及",
        "确认目标页是否覆盖该问题簇的关键事实",
        "必要时发起补采或补证，而不是直接宣称排名原因",
      ],
      completionCriteria: "补充可核验的页面或事实证据，或明确记录仍待补采。",
      retestMethod: "在同一轨道与过滤条件下复测该问题簇，核对提及标签是否变化。",
      businessImportance: importance,
      estimatedEffort: 2,
      verifiedEvidence: 0,
      privacyRisk: 0,
      title: "观察到品牌缺席，待验证假设",
    });
  }

  if (input.mentioned === "true" && input.recommended === "false" && owned) {
    drafts.push({
      gapType: "citation_gap",
      questionCluster: cluster,
      targetPage,
      observationId: input.observationId,
      analysisVersionId: input.analysisVersionId ?? null,
      evidenceSummary: `品牌被提及但未推荐；已有自有页引用 ${targetPage}。`,
      problemStatement: "提及与推荐不一致，需核对目标页是否提供可核验比较信息。",
      hypothesis: "目标页可能缺少选型边界或对比事实，导致推荐缺席。",
      assumptionLevel: "pending",
      steps: [
        "打开目标页核对关键事实是否完整",
        "补齐可公开比较点并保留来源",
        "完成后按同口径复测推荐标签",
      ],
      completionCriteria: "目标页关键事实可核验，或任务转补证并附理由。",
      retestMethod: "同题同轨复测推荐标签，记录前后样本 ID。",
      businessImportance: importance,
      estimatedEffort: 3,
      verifiedEvidence: 1,
      privacyRisk: 0,
      title: "提及未推荐：核对目标页事实",
    });
  }

  const restricted = input.citations.find((item) => item.pageStatus === "restricted");
  if (restricted) {
    drafts.push({
      gapType: "page_unreadable",
      questionCluster: cluster,
      targetPage: normalizeTargetPage(restricted.normalizedUrl),
      observationId: input.observationId,
      analysisVersionId: input.analysisVersionId ?? null,
      evidenceSummary: `引用页状态为受限：${normalizeTargetPage(restricted.normalizedUrl)}。`,
      problemStatement: "公开页面当前不可完整读取，需人工证据或待核验。",
      hypothesis: "访问受限不等于网站损坏，也不代表引擎无法收录。",
      assumptionLevel: "pending",
      steps: [
        "记录访问条件与时间",
        "必要时提交人工截图/正文证据",
        "恢复公开可读后再复测",
      ],
      completionCriteria: "页面可达并保留检查记录，或明确人工核验级别。",
      retestMethod: "复查公开状态后，不把单次速度或 robots 线索当作收录结论。",
      businessImportance: importance,
      estimatedEffort: 2,
      verifiedEvidence: 1,
      privacyRisk: 0,
      title: "公开页面受限，待核验",
    });
  }

  if (
    drafts.length === 0
    && (input.citationSetState === "missing" || input.citationSetState === "unsupported")
  ) {
    drafts.push({
      gapType: "needs_evidence",
      questionCluster: cluster,
      targetPage: "n/a",
      observationId: input.observationId,
      analysisVersionId: input.analysisVersionId ?? null,
      evidenceSummary: `引用集合状态为 ${input.citationSetState}，不足以生成可执行内容动作。`,
      problemStatement: "当前证据不足，需要补采或补证。",
      hypothesis: "在补齐可复查证据前，不生成营销断言。",
      assumptionLevel: "pending",
      steps: ["补采同口径样本", "补齐引用或人工证据", "再进入诊断"],
      completionCriteria: "具备可复查证据后重新生成任务。",
      retestMethod: "补证完成后重新运行诊断，不沿用不足证据。",
      businessImportance: importance,
      estimatedEffort: 1,
      verifiedEvidence: 0,
      privacyRisk: 0,
      title: "证据不足，转补采/补证",
    });
  }

  return drafts;
}

export function priorityBucketOf(draft: Pick<FindingDraft, "gapType" | "privacyRisk" | "assumptionLevel">) {
  if (draft.privacyRisk === 1) return "urgent" as const;
  if (draft.gapType === "fact_error" && draft.assumptionLevel === "verified") return "urgent" as const;
  return "normal" as const;
}

export function compareTaskPriority(a: PriorityFields, b: PriorityFields) {
  if (a.manualRank != null || b.manualRank != null) {
    const left = a.manualRank ?? Number.MAX_SAFE_INTEGER;
    const right = b.manualRank ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
  }
  if (a.priorityBucket !== b.priorityBucket) {
    return a.priorityBucket === "urgent" ? -1 : 1;
  }
  if (a.businessImportance !== b.businessImportance) {
    return b.businessImportance - a.businessImportance;
  }
  if (a.verifiedEvidence !== b.verifiedEvidence) {
    return b.verifiedEvidence - a.verifiedEvidence;
  }
  if (a.estimatedEffort !== b.estimatedEffort) {
    return a.estimatedEffort - b.estimatedEffort;
  }
  return a.createdAt.localeCompare(b.createdAt);
}

export type PageFetchResult = {
  url: string;
  status: "ok" | "restricted" | "error";
  title?: string;
  body?: string;
  accessCondition?: string;
};

export function inspectPage(result: PageFetchResult, checkedAt: string) {
  const normalizedUrl = normalizeTargetPage(result.url);
  if (result.status === "restricted" || result.status === "error") {
    return {
      url: result.url,
      normalizedUrl,
      checkedAt,
      accessCondition: result.accessCondition ?? (result.status === "restricted" ? "access-limited" : "fetch-error"),
      publicStatus: result.status === "restricted" ? "restricted" as const : "pending_verification" as const,
      title: result.title ?? null,
      bodyExcerpt: null,
      keyFacts: [] as string[],
      discoverabilityNotes: "单次检查不可推断引擎收录结果；访问受限不判网站损坏。",
      containsExecutableInstructions: 0 as 0 | 1,
    };
  }

  const body = result.body ?? "";
  const containsExecutableInstructions = EXECUTABLE_INSTRUCTION.test(body) ? 1 : 0;
  return {
    url: result.url,
    normalizedUrl,
    checkedAt,
    accessCondition: result.accessCondition ?? "anonymous-get",
    publicStatus: "reachable" as const,
    title: result.title ?? null,
    bodyExcerpt: body.slice(0, 500),
    keyFacts: [] as string[],
    discoverabilityNotes: containsExecutableInstructions
      ? "正文含发布/改权限类指令文本，仅只读标记，未执行；不据此宣称收录结果。"
      : "只读摘录公开正文；速度或结构化标记不等于引擎收录。",
    containsExecutableInstructions: containsExecutableInstructions as 0 | 1,
  };
}

export function assertsNoCausalClaim(text: string) {
  return !/(因(?:为)?软文(?:而)?(?:淘汰|排除)|引擎淘汰|模型淘汰品牌|软文导致)/.test(text);
}

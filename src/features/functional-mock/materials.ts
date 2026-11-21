import { randomUUID } from "node:crypto";
import type { FactFields } from "../brand-facts/contracts.ts";
import type { DraftContent } from "../prompts/contracts.ts";
import { functionalMockMarker } from "./mode.ts";

/** Labeled fact. sourceDate must be an ISO date on or before the approval day. */
export function mockFactFields(sourceDate: string): FactFields {
  return {
    category: "positioning",
    title: `${functionalMockMarker} 袋泡茶定位`,
    claim: `${functionalMockMarker} 合成事实：这不是真实品牌主张，也不能当作已核实的产品资料。`,
    sourceType: "material",
    sourceReference: `${functionalMockMarker} 仓库内合成材料，没有真实出处`,
    sourceLocator: "functional-mock#fact-1",
    sourceExcerpt: `${functionalMockMarker} 摘录同样是合成的，不能引用为公开证据。`,
    sourceDate,
    permission: "public",
    validity: "longTerm",
    validThrough: "",
    pasteId: null,
    pasteSpan: null,
  };
}

/** Three confirmed non-brand questions so the existing freeze rule can run. */
export function mockPromptContent(): DraftContent {
  const clusterId = randomUUID();
  const questions = [
    ["通勤时适合准备哪种无糖袋泡茶", "discovery", "awareness"],
    ["下午开会前想喝热茶时会比较哪些袋泡茶", "scenario", "consider"],
    ["不能接受高咖啡因时袋泡茶要满足什么条件", "constraint", "compare"],
  ] as const;
  return {
    clusters: [{
      id: clusterId,
      audience: "功能性 mock 的通勤购买者",
      intent: "比较合成题里的袋泡茶购买条件",
      primaryPage: "",
      conversionAction: "",
    }],
    questions: questions.map(([text, type, stage]) => ({
      id: randomUUID(),
      clusterId,
      text: `${functionalMockMarker} ${text}`,
      source: "manual" as const,
      sourceNote: "",
      type,
      stage,
      region: "CN",
      language: "zh-CN",
      status: "confirmed" as const,
      acceptSimilar: false,
      primary: false,
    })),
  };
}

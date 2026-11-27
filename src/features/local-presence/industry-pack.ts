import {
  industryPackQuestionBodySchema,
  type IndustryPackScenario,
  type IndustryPackStatus,
} from "./industry-pack-contracts.ts";

export type IndustryPackNextStatus = Exclude<IndustryPackStatus, "draft">;

export const industryPackTransitions: Record<IndustryPackStatus, readonly IndustryPackNextStatus[]> = {
  draft: ["reviewed"],
  reviewed: ["available", "retired"],
  available: ["retired"],
  retired: [],
};

export function canAdoptIndustryPack(status: IndustryPackStatus) {
  return status === "reviewed" || status === "available";
}

const widenScope = /忽略范围|忽略适用范围|ignore(?:\s+the)?\s+scope|扩大监管|扩大覆盖|expand(?:ed)?\s+regulated|covers?\s+regulated|covers_regulated|coversRegulated/i;
const effectGuarantee = /效果保证|保证效果|保证提升|承诺效果|保证排名|effect guarantee|guaranteed\s+(?:effect|improvement|ranking|result)|guarantee(?:s|d)?\s+(?:an\s+|the\s+)?(?:effect|improvement|ranking)/i;

export function materialsAskToWidenScope(materials: string) {
  return widenScope.test(materials);
}

export function isEffectGuarantee(text: string) {
  return effectGuarantee.test(text);
}

/** Coverage stays on the pack. Materials cannot turn an uncovered regulated request into an allowed one. */
export function industryPackScopeAllows(
  coversRegulated: 0 | 1,
  scenario: IndustryPackScenario,
  materials: string,
) {
  if (coversRegulated === 1) return true;
  if (scenario === "regulated") return false;
  return !materialsAskToWidenScope(materials);
}

export function draftQuestionBodies(questions: readonly string[]) {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const question of questions) {
    const sentences = question.split(/(?<=[。！？.!?])/u);
    const safe = sentences.filter((sentence) => !isEffectGuarantee(sentence) && !materialsAskToWidenScope(sentence));
    if (safe.length === 0) continue;
    const parsed = industryPackQuestionBodySchema.safeParse(safe.join(""));
    if (!parsed.success || [...parsed.data].length < 5) continue;
    const key = parsed.data.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(parsed.data);
  }
  return kept;
}
